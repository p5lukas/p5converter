package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/p5lukas/p5converter/internal/build"
	"github.com/p5lukas/p5converter/internal/ffmpeg"
	"github.com/p5lukas/p5converter/internal/logs"
	"github.com/p5lukas/p5converter/internal/proc"
)

// Probeclip: ein kurzer Ausschnitt (Standard 30 Sekunden aus der Mitte) wird mit mehreren Einstellungen umgewandelt. Für jede Einstellung gibt es Größe,
// Dauer und den Abstand zur Quelle (SSIM, PSNR) und dieselbe Bildstelle zum Ansehen. So lässt sich die Einstellung wählen, bevor eine ganze Staffel läuft.
// Der Ausschnitt wird ohne Neukodierung aus der Quelle geschnitten, alle Einstellungen und die Messung nutzen genau diese Datei.

const (
	clipMaxVariants = 5
	clipKeep        = 30 * time.Minute // fertige Läufe samt Bildern werden danach aufgeräumt
)

// ClipVariant ist eine Einstellung, die verglichen werden soll.
type ClipVariant struct {
	ID    string          `json:"id"`
	Label string          `json:"label"`
	Video build.VideoOpts `json:"video"`
}

type clipReq struct {
	Path     string        `json:"path"`
	Seconds  int           `json:"seconds"`
	Variants []ClipVariant `json:"variants"`
}

// ClipResult ist das Ergebnis je Einstellung.
type ClipResult struct {
	ID      string   `json:"id"`
	Label   string   `json:"label"`
	Status  string   `json:"status"` // wartet | läuft | fertig | fehler
	Error   string   `json:"error,omitempty"`
	Size    int64    `json:"size"`
	Ratio   float64  `json:"ratio"`   // Größe im Verhältnis zum Quell-Ausschnitt (Bild allein)
	Kbps    int      `json:"kbps"`    // Bitrate des Ergebnisses
	Seconds float64  `json:"seconds"` // so lange hat das Umwandeln gedauert
	Speed   float64  `json:"speed"`   // Ausschnitt-Länge ÷ Dauer (1 = Echtzeit)
	SSIM    float64  `json:"ssim"`
	PSNR    float64  `json:"psnr"`
	Backend string   `json:"backend,omitempty"`
	Encoder string   `json:"encoder,omitempty"`
	Images  []string `json:"images,omitempty"`
}

// ClipRun ist ein ganzer Lauf.
type ClipRun struct {
	ID        string        `json:"id"`
	Path      string        `json:"path"`
	Status    string        `json:"status"` // läuft | fertig | abgebrochen | fehler
	Error     string        `json:"error,omitempty"`
	Start     float64       `json:"start"`
	Length    float64       `json:"length"`
	SrcSize   int64         `json:"srcSize"`
	SrcKbps   int           `json:"srcKbps"`
	SrcWidth  int           `json:"srcWidth"`
	SrcHeight int           `json:"srcHeight"`
	Images    []string      `json:"images,omitempty"` // dieselben Bildstellen aus der Quelle
	Variants  []*ClipResult `json:"variants"`

	dir    string
	cancel context.CancelFunc
	ended  time.Time
}

type clipStore struct {
	mu   sync.Mutex
	runs map[string]*ClipRun
	seq  int
}

var (
	ssimRe = regexp.MustCompile(`All:([0-9.]+)`)
	psnrRe = regexp.MustCompile(`average:([0-9.]+|inf)`)
	idRe   = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,40}$`)
)

func (c *clipStore) snapshot(r *ClipRun) *ClipRun {
	c.mu.Lock()
	defer c.mu.Unlock()
	cp := *r
	cp.Variants = make([]*ClipResult, len(r.Variants))
	for i, v := range r.Variants {
		x := *v
		cp.Variants[i] = &x
	}
	return &cp
}

// sweep löscht alte Läufe (außer dem laufenden) samt Dateien
func (c *clipStore) sweep() {
	c.mu.Lock()
	defer c.mu.Unlock()
	for id, r := range c.runs {
		if r.Status != "läuft" && time.Since(r.ended) > clipKeep {
			os.RemoveAll(r.dir)
			delete(c.runs, id)
		}
	}
}

func (s *Server) clipStart(w http.ResponseWriter, r *http.Request) {
	var req clipReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpErr(w, 400, err.Error())
		return
	}
	req.Path = filepath.Clean(req.Path)
	if !s.allowed(req.Path) {
		httpErr(w, 403, "Pfad nicht erlaubt")
		return
	}
	if len(req.Variants) == 0 || len(req.Variants) > clipMaxVariants {
		httpErr(w, 400, fmt.Sprintf("Bitte 1 bis %d Einstellungen wählen.", clipMaxVariants))
		return
	}
	if req.Seconds <= 0 {
		req.Seconds = 30
	}
	if req.Seconds > 60 {
		req.Seconds = 60
	}
	res := s.Det.Result()
	for i := range req.Variants {
		v := &req.Variants[i]
		if v.ID == "" || !idRe.MatchString(v.ID) {
			v.ID = "v" + strconv.Itoa(i)
		}
		if v.Video.Codec == "" || v.Video.Codec == "copy" {
			httpErr(w, 400, "Ein Probeclip braucht einen Codec zum Umwandeln (nicht „Kopieren“).")
			return
		}
		v.Video.Container = "mkv"
		v.Video.HWDecode = false // der Ausschnitt ist klein; die CPU liest ihn
		if v.Video.Backend != "" && v.Video.Backend != "cpu" {
			if !res.Done {
				httpErr(w, 409, "Die Hardware-Erkennung läuft noch – bitte ein paar Sekunden warten und erneut starten.")
				return
			}
			ok := false
			for _, b := range res.Backends {
				if b.ID == v.Video.Backend && b.Codecs[v.Video.Codec] {
					ok = true
					if b.ID == "vaapi" && v.Video.VaapiDevice == "" {
						v.Video.VaapiDevice = b.Device
					}
					useDetected(&v.Video, b)
					v.Video.HWDecode = false
				}
			}
			if !ok {
				httpErr(w, 400, "Hardware-Encoder "+build.EncoderName(v.Video.Backend, v.Video.Codec)+" wurde nicht erkannt oder funktioniert nicht.")
				return
			}
		}
	}
	s.clips.sweep()
	s.clips.mu.Lock()
	for _, x := range s.clips.runs {
		if x.Status == "läuft" {
			s.clips.mu.Unlock()
			httpErr(w, 409, "Ein Probeclip läuft schon. Bitte warten oder ihn abbrechen.")
			return
		}
	}
	if s.clips.runs == nil {
		s.clips.runs = map[string]*ClipRun{}
	}
	s.clips.seq++
	id := "c" + strconv.Itoa(s.clips.seq)
	dir, err := os.MkdirTemp("", "p5c-clip-")
	if err != nil {
		s.clips.mu.Unlock()
		httpErr(w, 500, err.Error())
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	run := &ClipRun{ID: id, Path: req.Path, Status: "läuft", dir: dir, cancel: cancel}
	for _, v := range req.Variants {
		run.Variants = append(run.Variants, &ClipResult{ID: v.ID, Label: v.Label, Status: "wartet"})
	}
	s.clips.runs[id] = run
	s.clips.mu.Unlock()
	go s.clipRun(ctx, run, req)
	writeJSON(w, map[string]any{"id": id})
}

func (s *Server) clipGet(w http.ResponseWriter, r *http.Request) {
	s.clips.mu.Lock()
	run := s.clips.runs[r.PathValue("id")]
	s.clips.mu.Unlock()
	if run == nil {
		httpErr(w, 404, "Probeclip unbekannt (vielleicht schon aufgeräumt)")
		return
	}
	writeJSON(w, s.clips.snapshot(run))
}

func (s *Server) clipCancel(w http.ResponseWriter, r *http.Request) {
	s.clips.mu.Lock()
	run := s.clips.runs[r.PathValue("id")]
	s.clips.mu.Unlock()
	if run != nil && run.cancel != nil {
		run.cancel()
	}
	writeJSON(w, map[string]any{"ok": true})
}

func (s *Server) clipImage(w http.ResponseWriter, r *http.Request) {
	s.clips.mu.Lock()
	run := s.clips.runs[r.PathValue("id")]
	s.clips.mu.Unlock()
	name := r.PathValue("name")
	if run == nil || !idRe.MatchString(name) || !strings.HasSuffix(name, ".png") {
		httpErr(w, 404, "Bild unbekannt")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	http.ServeFile(w, r, filepath.Join(run.dir, name))
}

func (s *Server) clipSet(run *ClipRun, fn func()) { s.clips.mu.Lock(); fn(); s.clips.mu.Unlock() }

func (s *Server) clipFail(run *ClipRun, status, msg string) {
	s.clipSet(run, func() { run.Status, run.Error, run.ended = status, msg, time.Now() })
	if status == "fehler" {
		logs.Get("jobs").Warnf("Probeclip %s: %s", run.ID, msg)
	}
}

// ffmpegRun führt ffmpeg aus und liefert bei Fehlern die letzten Zeilen der Ausgabe
func (s *Server) ffmpegRun(ctx context.Context, args ...string) (string, error) {
	cmd := proc.CommandContext(ctx, s.Tools.FFmpeg, append([]string{"-hide_banner", "-nostdin", "-y"}, args...)...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		if ctx.Err() != nil {
			return string(out), ctx.Err()
		}
		lines := strings.Split(strings.TrimSpace(string(out)), "\n")
		if len(lines) > 4 {
			lines = lines[len(lines)-4:]
		}
		return string(out), fmt.Errorf("%s", strings.Join(lines, " | "))
	}
	return string(out), nil
}

func (s *Server) clipRun(ctx context.Context, run *ClipRun, req clipReq) {
	defer run.cancel()
	info, err := s.Tools.Probe(ctx, req.Path)
	if err != nil {
		s.clipFail(run, "fehler", err.Error())
		return
	}
	vs := info.FirstVideo()
	if vs == nil {
		s.clipFail(run, "fehler", "Die Datei hat keine Videospur.")
		return
	}
	length := float64(req.Seconds)
	if info.Duration > 0 && info.Duration < length {
		length = info.Duration
	}
	start := 0.0
	if info.Duration > length {
		start = info.Duration/2 - length/2
	}
	srcClip := filepath.Join(run.dir, "src.mkv")
	if _, err := s.ffmpegRun(ctx, "-ss", fmt.Sprintf("%.2f", start), "-i", req.Path, "-t", fmt.Sprintf("%.2f", length), "-map", "0:"+strconv.Itoa(vs.Index), "-c", "copy", "-an", "-sn", "-dn", srcClip); err != nil {
		s.clipStatus(run, err, "Der Ausschnitt ließ sich nicht schneiden: ")
		return
	}
	cinfo, err := s.Tools.Probe(ctx, srcClip)
	if err != nil {
		s.clipFail(run, "fehler", err.Error())
		return
	}
	var srcSize int64
	if st, e := os.Stat(srcClip); e == nil {
		srcSize = st.Size()
	}
	cv := cinfo.FirstVideo()
	s.clipSet(run, func() {
		run.Start, run.Length, run.SrcSize, run.SrcKbps = start, length, srcSize, int(float64(srcSize)*8/length/1000)
		if cv != nil {
			run.SrcWidth, run.SrcHeight = cv.Width, cv.Height
		}
	})
	// Bildstellen: bei 30 % und 70 % des Ausschnitts, vergrößerte Mitte (so sieht man Blöcke, Rauschen und weiche Kanten)
	times := []float64{length * 0.3, length * 0.7}
	frame := func(file, name string, w, h int, t float64) error {
		vf := fmt.Sprintf("scale=%d:%d:flags=lanczos,crop=iw/3:ih/3:iw/3:ih/3,scale=iw*2:ih*2:flags=neighbor", w, h)
		_, e := s.ffmpegRun(ctx, "-ss", fmt.Sprintf("%.2f", t), "-i", file, "-frames:v", "1", "-vf", vf, filepath.Join(run.dir, name))
		return e
	}
	for i, t := range times {
		if cv == nil || cv.Width == 0 {
			break
		}
		name := fmt.Sprintf("src-%d.png", i+1)
		if frame(srcClip, name, cv.Width, cv.Height, t) == nil {
			s.clipSet(run, func() { run.Images = append(run.Images, name) })
		}
	}
	for i, v := range req.Variants {
		if ctx.Err() != nil {
			break
		}
		s.clipVariant(ctx, run, i, v, cinfo, srcClip, srcSize, length, times, frame)
	}
	if ctx.Err() != nil {
		s.clipFail(run, "abgebrochen", "Abgebrochen.")
		return
	}
	s.clipSet(run, func() { run.Status, run.ended = "fertig", time.Now() })
}

func (s *Server) clipStatus(run *ClipRun, err error, prefix string) {
	if err == context.Canceled {
		s.clipFail(run, "abgebrochen", "Abgebrochen.")
		return
	}
	s.clipFail(run, "fehler", prefix+err.Error())
}

func (s *Server) clipVariant(ctx context.Context, run *ClipRun, i int, v ClipVariant, cinfo *ffmpeg.Info, srcClip string, srcSize int64, length float64, times []float64, frame func(file, name string, w, h int, t float64) error) {
	res := run.Variants[i]
	fail := func(msg string) { s.clipSet(run, func() { res.Status, res.Error = "fehler", msg }) }
	s.clipSet(run, func() { res.Status = "läuft" })
	out := filepath.Join(run.dir, fmt.Sprintf("v%d.mkv", i))
	plan, err := build.BuildVideo(cinfo, v.Video, build.Overrides{}, srcClip, out)
	if err != nil {
		fail(err.Error())
		return
	}
	s.clipSet(run, func() { res.Backend, res.Encoder = plan.Backend, plan.Encoder })
	t0 := time.Now()
	cmd := proc.CommandContext(ctx, s.Tools.FFmpeg, plan.Args...)
	if b, e := cmd.CombinedOutput(); e != nil {
		if ctx.Err() != nil {
			return
		}
		lines := strings.Split(strings.TrimSpace(string(b)), "\n")
		if len(lines) > 4 {
			lines = lines[len(lines)-4:]
		}
		fail(strings.Join(lines, " | "))
		return
	}
	took := time.Since(t0).Seconds()
	st, e := os.Stat(out)
	if e != nil {
		fail(e.Error())
		return
	}
	oinfo, err := s.Tools.Probe(ctx, out)
	var ov *ffmpeg.Stream
	if err == nil {
		ov = oinfo.FirstVideo()
	}
	w, h := 0, 0
	if ov != nil {
		w, h = ov.Width, ov.Height
	}
	var ssim, psnr float64
	if w > 0 {
		fc := fmt.Sprintf("[0:v]format=yuv420p10le[d];[1:v]scale=%d:%d:flags=lanczos,format=yuv420p10le[r];[d][r]", w, h)
		if o, e := s.ffmpegRun(ctx, "-i", out, "-i", srcClip, "-filter_complex", fc+"ssim", "-f", "null", "-"); e == nil {
			if m := ssimRe.FindAllStringSubmatch(o, -1); len(m) > 0 {
				ssim, _ = strconv.ParseFloat(m[len(m)-1][1], 64)
			}
		}
		if o, e := s.ffmpegRun(ctx, "-i", out, "-i", srcClip, "-filter_complex", fc+"psnr", "-f", "null", "-"); e == nil {
			if m := psnrRe.FindAllStringSubmatch(o, -1); len(m) > 0 {
				if m[len(m)-1][1] == "inf" {
					psnr = 99
				} else {
					psnr, _ = strconv.ParseFloat(m[len(m)-1][1], 64)
				}
			}
		}
	}
	var imgs []string
	for k, t := range times {
		if w == 0 {
			break
		}
		name := fmt.Sprintf("v%d-%d.png", i, k+1)
		if frame(out, name, w, h, t) == nil {
			imgs = append(imgs, name)
		}
	}
	s.clipSet(run, func() {
		res.Status, res.Size, res.Seconds = "fertig", st.Size(), took
		if srcSize > 0 {
			res.Ratio = float64(st.Size()) / float64(srcSize)
		}
		if length > 0 {
			res.Kbps = int(float64(st.Size()) * 8 / length / 1000)
			if took > 0 {
				res.Speed = length / took
			}
		}
		res.SSIM, res.PSNR, res.Images = ssim, psnr, imgs
	})
	os.Remove(out) // die Bilder bleiben, die Videodatei wird nicht mehr gebraucht
}
