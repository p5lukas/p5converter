package server

// Encoder-Schnelltest (Einstellungen → Hardware): Eine kurze synthetische Testquelle (Standard 10 Sekunden, 1080p, ohne Dateien des Nutzers) wird mit
// jedem erkannten, funktionierenden Encoder und Codec in der Qualitätsstufe „Gut“ umgewandelt. Gemessen werden Geschwindigkeit (× Echtzeit, Bilder je Sekunde),
// Größe und Bitrate; daraus ergibt sich, welcher Encoder auf diesem Rechner am schnellsten ist. Die Ausgabe landet in einem temporären Ordner, der danach
// gelöscht wird. Der Test läuft nie neben Aufträgen (er startet nicht, solange einer läuft, und markiert sich als „gestört“, wenn währenddessen einer anläuft).

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/p5lukas/p5converter/internal/build"
	"github.com/p5lukas/p5converter/internal/hw"
	"github.com/p5lukas/p5converter/internal/proc"
)

// Qualitätsstufe „Gut“ je Encoder und Codec (dieselben Startwerte wie web/quality.js, Spalte 2)
var benchCRF = map[string]map[string]int{
	"cpu":   {"h264": 18, "hevc": 20, "av1": 24},
	"qsv":   {"h264": 18, "hevc": 19, "av1": 22},
	"nvenc": {"h264": 21, "hevc": 23, "av1": 27},
	"vaapi": {"h264": 21, "hevc": 22, "av1": 25},
	"amf":   {"h264": 21, "hevc": 22, "av1": 25},
}

// BenchResult ist das Ergebnis je Encoder und Codec.
type BenchResult struct {
	ID      string  `json:"id"`
	Backend string  `json:"backend"`
	Label   string  `json:"label"`
	Codec   string  `json:"codec"`
	Encoder string  `json:"encoder,omitempty"`
	Status  string  `json:"status"` // wartet | läuft | fertig | fehler
	Error   string  `json:"error,omitempty"`
	Seconds float64 `json:"seconds"` // so lange hat das Umwandeln gedauert
	Speed   float64 `json:"speed"`   // Länge der Quelle ÷ Dauer (1 = Echtzeit)
	FPS     float64 `json:"fps"`
	Size    int64   `json:"size"`
	Kbps    int     `json:"kbps"`
}

// BenchRun ist ein ganzer Test.
type BenchRun struct {
	ID          string         `json:"id"`
	Status      string         `json:"status"` // läuft | fertig | abgebrochen | fehler
	Error       string         `json:"error,omitempty"`
	Length      int            `json:"length"` // Sekunden der Testquelle
	Disturbed   bool           `json:"disturbed"`
	Fingerprint string         `json:"fingerprint"`
	Finished    time.Time      `json:"finished"`
	Results     []*BenchResult `json:"results"`
	Fastest     string         `json:"fastest,omitempty"` // ID des schnellsten Ergebnisses (H.265 vor den anderen Codecs, wenn vorhanden, sonst der schnellste)

	dir    string
	cancel context.CancelFunc
}

type benchStore struct {
	mu   sync.Mutex
	seq  int
	runs map[string]*BenchRun
	last *BenchRun // letzter fertiger Lauf
	file string    // bench.json in /config (leer: nur im Speicher)
}

// benchFingerprint beschreibt die erkannte Hardware: ändert sie sich, gilt ein gemerktes Ergebnis nicht mehr.
func benchFingerprint(res hw.Result) string {
	var p []string
	for _, b := range res.Backends {
		var cs []string
		for c, ok := range b.Codecs {
			if ok {
				cs = append(cs, c)
			}
		}
		sort.Strings(cs)
		p = append(p, b.ID+":"+b.GPU+":"+strings.Join(cs, ","))
	}
	return strings.Join(p, "|")
}

func (b *benchStore) load() {
	if b.file == "" {
		return
	}
	if raw, err := os.ReadFile(b.file); err == nil {
		var r BenchRun
		if json.Unmarshal(raw, &r) == nil && r.Status == "fertig" {
			b.last = &r
		}
	}
}

func (b *benchStore) save(r *BenchRun) {
	if b.file == "" {
		return
	}
	if raw, err := json.Marshal(r); err == nil {
		tmp := b.file + ".tmp"
		if os.WriteFile(tmp, raw, 0o644) == nil {
			os.Rename(tmp, b.file)
		}
	}
}

func (b *benchStore) snapshot(r *BenchRun) *BenchRun {
	c := *r
	c.Results = make([]*BenchResult, len(r.Results))
	for i, x := range r.Results {
		y := *x
		c.Results[i] = &y
	}
	return &c
}

// benchVariants: alle erkannten, funktionierenden Kombinationen aus Encoder und Codec (H.264, H.265, AV1), die CPU zuerst
func benchVariants(res hw.Result) []benchVariant {
	var out []benchVariant
	order := map[string]int{"cpu": 0, "qsv": 1, "nvenc": 2, "vaapi": 3, "amf": 4}
	bs := append([]hw.Backend(nil), res.Backends...)
	sort.SliceStable(bs, func(i, j int) bool { return order[bs[i].ID] < order[bs[j].ID] })
	for _, b := range bs {
		for _, c := range []string{"h264", "hevc", "av1"} {
			if !b.Codecs[c] {
				continue
			}
			crf, ok := benchCRF[b.ID][c]
			if !ok {
				continue
			}
			out = append(out, benchVariant{b: b, codec: c, crf: crf})
		}
	}
	return out
}

type benchVariant struct {
	b     hw.Backend
	codec string
	crf   int
}

func (s *Server) benchStart(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Seconds int `json:"seconds"`
	}
	json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req)
	if req.Seconds <= 0 {
		req.Seconds = 10
	}
	if n, _ := strconv.Atoi(os.Getenv("P5_TEST_BENCH_SECONDS")); n > 0 { // nur für Tests: kürzere Testquelle
		req.Seconds = n
	}
	if req.Seconds > 30 {
		req.Seconds = 30
	}
	res := s.Det.Result()
	if !res.Done {
		httpErr(w, 409, "Die Hardware-Erkennung läuft noch – bitte ein paar Sekunden warten und erneut starten.")
		return
	}
	vs := benchVariants(res)
	if len(vs) == 0 {
		httpErr(w, 409, "Es wurde kein funktionierender Encoder erkannt.")
		return
	}
	if n := s.Jobs.Running(); n > 0 {
		httpErr(w, 409, "Es laufen Aufträge. Der Schnelltest misst nur sinnvoll, wenn der Rechner sonst nichts tut: bitte warten, bis sie fertig sind.")
		return
	}
	s.bench.mu.Lock()
	for _, x := range s.bench.runs {
		if x.Status == "läuft" {
			s.bench.mu.Unlock()
			httpErr(w, 409, "Der Schnelltest läuft schon.")
			return
		}
	}
	s.clips.mu.Lock()
	for _, x := range s.clips.runs {
		if x.Status == "läuft" {
			s.clips.mu.Unlock()
			s.bench.mu.Unlock()
			httpErr(w, 409, "Ein Probeclip läuft. Bitte warten oder ihn abbrechen.")
			return
		}
	}
	s.clips.mu.Unlock()
	dir, err := os.MkdirTemp("", "p5c-bench-")
	if err != nil {
		s.bench.mu.Unlock()
		httpErr(w, 500, err.Error())
		return
	}
	if s.bench.runs == nil {
		s.bench.runs = map[string]*BenchRun{}
	}
	s.bench.seq++
	id := "t" + strconv.Itoa(s.bench.seq)
	ctx, cancel := context.WithCancel(context.Background())
	run := &BenchRun{ID: id, Status: "läuft", Length: req.Seconds, Fingerprint: benchFingerprint(res), dir: dir, cancel: cancel}
	for _, v := range vs {
		run.Results = append(run.Results, &BenchResult{ID: v.b.ID + "-" + v.codec, Backend: v.b.ID, Label: v.b.Label, Codec: v.codec, Status: "wartet"})
	}
	s.bench.runs[id] = run
	s.bench.mu.Unlock()
	go s.benchRun(ctx, run, vs)
	writeJSON(w, map[string]string{"id": id})
}

func (s *Server) benchSet(run *BenchRun, fn func()) { s.bench.mu.Lock(); fn(); s.bench.mu.Unlock() }

func (s *Server) benchRun(ctx context.Context, run *BenchRun, vs []benchVariant) {
	defer os.RemoveAll(run.dir)
	defer run.cancel()
	finish := func(status, msg string) {
		s.benchSet(run, func() {
			run.Status, run.Error, run.Finished = status, msg, time.Now()
			if status == "fertig" {
				run.Fastest = benchFastest(run.Results)
				s.bench.last = s.bench.snapshot(run)
				s.bench.save(s.bench.last)
			}
		})
	}
	src := filepath.Join(run.dir, "quelle.mkv")
	if _, err := s.ffmpegRun(ctx, "-f", "lavfi", "-i", fmt.Sprintf("testsrc2=size=1920x1080:rate=30:duration=%d", run.Length),
		"-c:v", "libx264", "-preset", "ultrafast", "-crf", "14", "-pix_fmt", "yuv420p", src); err != nil {
		if ctx.Err() != nil {
			finish("abgebrochen", "")
			return
		}
		finish("fehler", "Die Testquelle ließ sich nicht erzeugen: "+err.Error())
		return
	}
	info, err := s.Tools.Probe(ctx, src)
	if err != nil {
		finish("fehler", err.Error())
		return
	}
	for i, v := range vs {
		if ctx.Err() != nil {
			finish("abgebrochen", "")
			return
		}
		if s.Jobs.Running() > 0 {
			s.benchSet(run, func() { run.Disturbed = true })
		}
		res := run.Results[i]
		fail := func(msg string) { s.benchSet(run, func() { res.Status, res.Error = "fehler", msg }) }
		s.benchSet(run, func() { res.Status = "läuft" })
		opts := build.VideoOpts{Container: "mkv", Codec: v.codec, Backend: v.b.ID, CRF: v.crf, Preset: "medium", BitDepth: 8, AudioMode: "copy", SubMode: "none"}
		if v.b.ID == "vaapi" {
			opts.VaapiDevice = v.b.Device
		}
		if v.b.ID != "cpu" {
			useDetected(&opts, v.b)
		}
		opts.HWDecode = false // gemessen wird das Schreiben; die CPU liest die kleine Testquelle
		out := filepath.Join(run.dir, fmt.Sprintf("t%d.mkv", i))
		plan, err := build.BuildVideo(info, opts, build.Overrides{}, src, out)
		if err != nil {
			fail(err.Error())
			continue
		}
		s.benchSet(run, func() { res.Encoder = plan.Encoder })
		t0 := time.Now()
		if b, e := proc.CommandContext(ctx, s.Tools.FFmpeg, plan.Args...).CombinedOutput(); e != nil {
			if ctx.Err() != nil {
				finish("abgebrochen", "")
				return
			}
			lines := strings.Split(strings.TrimSpace(string(b)), "\n")
			if len(lines) > 3 {
				lines = lines[len(lines)-3:]
			}
			fail(strings.Join(lines, " | "))
			continue
		}
		took := time.Since(t0).Seconds()
		st, e := os.Stat(out)
		if e != nil || st.Size() == 0 {
			fail("keine Ausgabe")
			continue
		}
		os.Remove(out)
		if s.Jobs.Running() > 0 {
			s.benchSet(run, func() { run.Disturbed = true })
		}
		s.benchSet(run, func() {
			res.Status, res.Seconds, res.Size = "fertig", took, st.Size()
			if took > 0 {
				res.Speed = float64(run.Length) / took
				res.FPS = float64(run.Length*30) / took
			}
			res.Kbps = int(float64(st.Size()) * 8 / float64(run.Length) / 1000)
		})
	}
	finish("fertig", "")
}

// benchFastest: das schnellste fertige Ergebnis mit H.265; gibt es keins, das schnellste überhaupt (ID, "" = nichts fertig)
func benchFastest(rs []*BenchResult) string {
	best := func(codec string) string {
		var id string
		var sp float64
		for _, r := range rs {
			if r.Status == "fertig" && (codec == "" || r.Codec == codec) && r.Speed > sp {
				id, sp = r.ID, r.Speed
			}
		}
		return id
	}
	if id := best("hevc"); id != "" {
		return id
	}
	return best("")
}

func (s *Server) benchGet(w http.ResponseWriter, r *http.Request) {
	s.bench.mu.Lock()
	defer s.bench.mu.Unlock()
	run := s.bench.runs[r.PathValue("id")]
	if run == nil {
		httpErr(w, 404, "Unbekannter Schnelltest")
		return
	}
	writeJSON(w, s.bench.snapshot(run))
}

func (s *Server) benchCancel(w http.ResponseWriter, r *http.Request) {
	s.bench.mu.Lock()
	run := s.bench.runs[r.PathValue("id")]
	s.bench.mu.Unlock()
	if run != nil {
		run.cancel()
	}
	writeJSON(w, map[string]bool{"ok": true})
}

// benchLast liefert den letzten fertigen Lauf, solange die erkannte Hardware dieselbe ist (sonst "last": null)
func (s *Server) benchLast(w http.ResponseWriter, r *http.Request) {
	s.bench.mu.Lock()
	defer s.bench.mu.Unlock()
	last := s.bench.last
	if last != nil && last.Fingerprint != benchFingerprint(s.Det.Result()) {
		last = nil
	}
	writeJSON(w, map[string]any{"last": last})
}
