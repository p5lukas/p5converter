// Package jobs runs the conversion queue.
package jobs

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"github.com/p5lukas/p5converter/internal/proc"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/p5lukas/p5converter/internal/build"
	"github.com/p5lukas/p5converter/internal/ffmpeg"
	"github.com/p5lukas/p5converter/internal/hw"
	"github.com/p5lukas/p5converter/internal/logs"
	"github.com/p5lukas/p5converter/internal/rename"
)

type Item struct {
	Path      string          `json:"path"`
	Rel       string          `json:"rel"` // path relative to the added folder (for "keep structure")
	Overrides build.Overrides `json:"overrides"`
}

type OutputOpts struct {
	Dir          string        `json:"dir"`       // "" = next to source
	Structure    string        `json:"structure"` // flat | keep
	Suffix       string        `json:"suffix"`
	Pattern      string        `json:"pattern"` // e.g. {artist}/{album}/{track} - {title} (audio) or {title} [{res}][{codec}] (video)
	Replace      []rename.Rule `json:"replace"` // search & replace on the file name
	Exists       string        `json:"exists"`  // skip | overwrite | rename
	DeleteSource bool          `json:"deleteSource"`
	// Controls after the conversion (the basic check - readable, same length - always runs):
	VerifyTracks bool `json:"verifyTracks"` // A: tracks complete, size plausible
	VerifyDecode bool `json:"verifyDecode"` // B: read the whole result once, report damaged spots
	Grace        bool `json:"grace"`        // C: do not delete the source at once, move it away for GraceDays
	GraceDays    int  `json:"graceDays"`
}

type Request struct {
	Kind   string          `json:"kind"` // audio | video
	Items  []Item          `json:"items"`
	Audio  build.AudioOpts `json:"audio"`
	Video  build.VideoOpts `json:"video"`
	Output OutputOpts      `json:"output"`
}

type Job struct {
	ID       string  `json:"id"`
	Kind     string  `json:"kind"`
	Name     string  `json:"name"`
	Input    string  `json:"input"`
	Output   string  `json:"output"`
	Status   string  `json:"status"` // queued running done error canceled skipped
	Progress float64 `json:"progress"`
	FPS      float64 `json:"fps"`
	Speed    string  `json:"speed"`
	ETA      int     `json:"eta"`
	Backend  string  `json:"backend"`
	Encoder  string  `json:"encoder"`
	// EncoderConfirmed: ffmpeg itself reported using this encoder.
	EncoderConfirmed bool `json:"encoderConfirmed"`
	HWDecodeFallback bool `json:"hwDecodeFallback"`
	// Decoder: "hardware" or "software" (empty: nothing is decoded, e.g. copy or audio).
	Decoder string `json:"decoder,omitempty"`
	// DecoderName/DecoderConfirmed: the decoder ffmpeg itself reported (e.g. hevc_qsv); confirmed = a hardware decoder.
	DecoderName      string `json:"decoderName,omitempty"`
	DecoderConfirmed bool   `json:"decoderConfirmed"`
	// Attempts: short notes about earlier tries that failed before the current one (shown calmly, not as an error).
	Attempts []string `json:"attempts,omitempty"`
	Cmd      string   `json:"cmd"`
	Error    string   `json:"error,omitempty"`
	Warnings []string `json:"warnings,omitempty"`
	MapLines []string `json:"mapLines,omitempty"`
	Log      []string `json:"log,omitempty"`
	// Phase: "check" while the result is being verified (the conversion itself is finished).
	Phase string `json:"phase,omitempty"`
	// Checks: what the control after the conversion found; CheckFailed = at least one failed (the source is then kept).
	Checks      []Check `json:"checks,omitempty"`
	CheckFailed bool    `json:"checkFailed"`
	// Trashed: where the source waits during its grace period.
	Trashed string    `json:"trashed,omitempty"`
	SizeIn  int64     `json:"sizeIn"`
	SizeOut int64     `json:"sizeOut"`
	Created time.Time `json:"created"`
	Started time.Time `json:"started"`
	Ended   time.Time `json:"ended"`

	item      Item
	req       *Request
	cancel    context.CancelFunc
	cancelled bool
}

type Manager struct {
	tools   ffmpeg.Tools
	sampler *hw.Sampler

	mu          sync.Mutex
	jobs        []*Job
	seq         int
	concurrency map[string]int // per world: audio and video have their own queue
	running     map[string]int
	reserved    map[string]string // output path -> job id (queued/running jobs)
	// OnDone is called after every successful conversion (kind, bytes in, bytes out).
	OnDone      func(kind string, in, out int64)
	partialFile string
	partials    map[string]bool
	graceFile   string
	grace       map[string]int64 // source in a trash folder -> unix time after which it is removed
}

func New(t ffmpeg.Tools, s *hw.Sampler, concurrency int) *Manager {
	m := &Manager{tools: t, sampler: s, reserved: map[string]string{},
		concurrency: map[string]int{"audio": concurrency, "video": concurrency}, running: map[string]int{}}
	go m.samplerLoop()
	return m
}

func (m *Manager) samplerLoop() {
	for {
		m.sampler.Sample() // always: a frozen value from the last job would look like a measurement
		m.mu.Lock()
		r := m.running["audio"] + m.running["video"]
		m.mu.Unlock()
		if r > 0 {
			time.Sleep(1500 * time.Millisecond)
		} else {
			time.Sleep(3 * time.Second)
		}
	}
}

func clampConc(n int) int {
	if n < 1 {
		return 1
	}
	if n > 8 {
		return 8
	}
	return n
}

// SetConcurrency sets the parallel jobs of one world ("audio" | "video").
func (m *Manager) SetConcurrency(kind string, n int) {
	if kind != "audio" && kind != "video" {
		return
	}
	m.mu.Lock()
	m.concurrency[kind] = clampConc(n)
	m.mu.Unlock()
	m.schedule()
}

func (m *Manager) Concurrency(kind string) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.concurrency[kind]
}

func (m *Manager) Submit(req *Request) []string {
	m.mu.Lock()
	var ids []string
	for _, it := range req.Items {
		m.seq++
		j := &Job{ID: "j" + strconv.Itoa(m.seq), Kind: req.Kind, Name: filepath.Base(it.Path), Input: it.Path,
			Status: "queued", Created: time.Now(), item: it, req: req, Speed: ""}
		if st, err := os.Stat(it.Path); err == nil {
			j.SizeIn = st.Size()
		}
		m.jobs = append(m.jobs, j)
		ids = append(ids, j.ID)
	}
	m.mu.Unlock()
	m.schedule()
	return ids
}

func (m *Manager) Snapshot() []Job {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]Job, len(m.jobs))
	for i, j := range m.jobs {
		c := *j
		c.Log = append([]string(nil), j.Log...)
		c.MapLines = append([]string(nil), j.MapLines...)
		c.Warnings = append([]string(nil), j.Warnings...)
		c.Checks = append([]Check(nil), j.Checks...)
		if len(c.Log) > 25 && c.Status == "running" {
			c.Log = c.Log[len(c.Log)-25:]
		}
		out[i] = c
	}
	return out
}

func (m *Manager) Cancel(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, j := range m.jobs {
		if j.ID == id {
			m.cancelLocked(j)
		}
	}
}

// CancelAll cancels the jobs of one world (kind "" = both).
func (m *Manager) CancelAll(kind string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, j := range m.jobs {
		if kind == "" || j.Kind == kind {
			m.cancelLocked(j)
		}
	}
}

func (m *Manager) cancelLocked(j *Job) {
	switch j.Status {
	case "queued":
		j.Status = "canceled"
		j.Ended = time.Now()
	case "running":
		j.cancelled = true
		if j.cancel != nil {
			j.cancel()
		}
	}
}

// ClearFinished removes finished jobs of one world (kind "" = both).
func (m *Manager) ClearFinished(kind string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var keep []*Job
	for _, j := range m.jobs {
		if j.Status == "queued" || j.Status == "running" || (kind != "" && j.Kind != kind) {
			keep = append(keep, j)
		}
	}
	m.jobs = keep
}

func (m *Manager) schedule() {
	m.mu.Lock()
	defer m.mu.Unlock()
	// each world has its own queue and its own number of parallel jobs
	for _, kind := range []string{"audio", "video"} {
		for m.running[kind] < m.concurrency[kind] {
			var next *Job
			for _, j := range m.jobs {
				if j.Status == "queued" && j.Kind == kind {
					next = j
					break
				}
			}
			if next == nil {
				break
			}
			next.Status = "running"
			next.Started = time.Now()
			m.running[kind]++
			go func(j *Job) {
				m.run(j)
				m.mu.Lock()
				m.running[j.Kind]--
				m.mu.Unlock()
				m.schedule()
			}(next)
		}
	}
}

func (m *Manager) update(j *Job, f func()) {
	m.mu.Lock()
	f()
	m.mu.Unlock()
}

func (m *Manager) wasCancelled(j *Job) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return j.cancelled
}

var jlog = logs.Get("jobs")

// gpuNames: backends whose decoding can be done on the GPU with the full / download / CPU fallback chain.
var gpuNames = map[string]string{"qsv": "Quick Sync", "vaapi": "VAAPI", "nvenc": "NVIDIA"}

func (m *Manager) fail(j *Job, err error) {
	m.update(j, func() {
		j.Status = "error"
		j.Error = err.Error()
		j.Ended = time.Now()
	})
	jlog.Errorf("Auftrag %s fehlgeschlagen: %s – %v", j.ID, filepath.Base(j.item.Path), err)
}

func outputPath(j *Job, info *ffmpeg.Info) string {
	o := j.req.Output
	in := j.item.Path
	ext := "mkv"
	if j.Kind == "audio" {
		ext = build.AudioExt(j.req.Audio.Format)
	} else if j.req.Video.Container == "mp4" {
		ext = "mp4"
	}
	dir := filepath.Dir(in)
	if o.Dir != "" {
		dir = o.Dir
		if o.Structure == "keep" && j.item.Rel != "" {
			dir = filepath.Join(dir, filepath.Dir(filepath.FromSlash(j.item.Rel)))
		}
	}
	t := rename.Target{Container: ext}
	if j.Kind == "video" {
		t.Codec, t.Height, t.BitDepth = j.req.Video.Codec, j.req.Video.Height, j.req.Video.BitDepth
	}
	base := strings.TrimSuffix(filepath.Base(in), filepath.Ext(in)) + o.Suffix
	if nn, err := rename.NewName(o.Pattern, o.Replace, o.Suffix, info, in, t); err == nil {
		// the pattern may carry sub folders (audio and video)
		parts := strings.Split(nn, "/")
		for i, p := range parts[:len(parts)-1] {
			parts[i] = rename.Safe(p)
		}
		if o.Dir == "" {
			dir = filepath.Dir(in)
		}
		dir = filepath.Join(append([]string{dir}, parts[:len(parts)-1]...)...)
		base = parts[len(parts)-1]
	}
	out := filepath.Join(dir, base+"."+ext)
	if filepath.Clean(out) == filepath.Clean(in) {
		out = filepath.Join(dir, base+" (konvertiert)."+ext)
	}
	return out
}

// claimOutput picks the final output path for j and reserves it, so two parallel jobs never
// write the same file. ok=false means the job should be skipped.
func (m *Manager) claimOutput(j *Job, out string) (string, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, err := os.Stat(out)
	_, taken := m.reserved[out]
	if err == nil || taken {
		switch j.req.Output.Exists {
		case "skip":
			return out, false
		case "overwrite":
			if !taken {
				m.reserved[out] = j.ID
				return out, true
			}
		}
		ext := filepath.Ext(out)
		base := strings.TrimSuffix(out, ext)
		for i := 2; ; i++ {
			c := fmt.Sprintf("%s (%d)%s", base, i, ext)
			if _, e := os.Stat(c); os.IsNotExist(e) {
				if _, t := m.reserved[c]; !t {
					out = c
					break
				}
			}
		}
	}
	m.reserved[out] = j.ID
	return out, true
}

func (m *Manager) release(out string) {
	m.mu.Lock()
	delete(m.reserved, out)
	m.mu.Unlock()
}

var mapRe = regexp.MustCompile(`^Stream #\d+:\d+ -> #\d+:\d+ \(`)

func (m *Manager) run(j *Job) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	m.update(j, func() { j.cancel = cancel })

	info, err := m.tools.Probe(ctx, j.item.Path)
	if err != nil {
		m.fail(j, err)
		return
	}
	out, ok := m.claimOutput(j, outputPath(j, info))
	if !ok {
		m.update(j, func() {
			j.Status = "skipped"
			j.Output = out
			j.Ended = time.Now()
			j.Error = "Zieldatei existiert bereits"
		})
		jlog.Warnf("Auftrag %s übersprungen: Zieldatei existiert bereits (%s)", j.ID, out)
		return
	}
	defer m.release(out)
	m.update(j, func() { j.Output = out })
	jlog.Infof("Auftrag %s gestartet: %s → %s", j.ID, j.item.Path, out)
	newDirs := missingDirs(filepath.Dir(out))
	if err := os.MkdirAll(filepath.Dir(out), 0o755); err != nil {
		m.fail(j, err)
		return
	}
	tmp := out + ".part"
	m.trackPartial(tmp, true)
	defer m.trackPartial(tmp, false)
	// folders this job created are removed again when nothing came out of it (cancel or error)
	cleanup := func() {
		os.Remove(tmp)
		m.removeEmptyDirs(newDirs, out)
	}

	type attempt struct {
		hwdec bool
		mode  string
		label string
	}
	buildArgs := func(a attempt) ([]string, error) {
		if j.Kind == "audio" {
			return build.BuildAudio(info, j.req.Audio, j.item.Path, tmp)
		}
		v := j.req.Video
		v.HWDecode = v.HWDecode && a.hwdec
		v.HWDecodeMode = a.mode
		plan, err := build.BuildVideo(info, v, j.item.Overrides, j.item.Path, tmp)
		if err != nil {
			return nil, err
		}
		m.update(j, func() {
			j.Backend, j.Encoder, j.Warnings = plan.Backend, plan.Encoder, plan.Warnings
		})
		return plan.Args, nil
	}

	attempts := []attempt{{hwdec: false}}
	if j.Kind == "video" {
		v := j.req.Video
		if v.HWDecode && v.Backend != "cpu" && v.Codec != "copy" {
			if name, ok := gpuNames[v.Backend]; ok {
				// qsv, vaapi, nvenc: first everything on the GPU, then frames copied back to normal memory, last the CPU reads
				attempts = []attempt{
					{true, "full", name + " lesen (alles auf der Hardware)"},
					{true, "download", name + " lesen (Bilder zurück in den Arbeitsspeicher)"},
					{false, "", ""},
				}
			} else {
				attempts = []attempt{{true, "", "Hardware-Decoding"}, {false, "", ""}}
			}
		}
	}
	var usedArgs []string
	for i, a := range attempts {
		args, e := buildArgs(a)
		if e != nil {
			m.fail(j, e)
			return
		}
		m.update(j, func() {
			switch {
			case j.Kind != "video" || j.req.Video.Codec == "copy":
				j.Decoder = ""
			case a.hwdec:
				j.Decoder = "hardware"
			default:
				j.Decoder = "software"
			}
			j.HWDecodeFallback = len(attempts) > 1 && !a.hwdec
			j.Progress = 0
		})
		usedArgs = args
		err = m.exec(ctx, j, args, info.Duration)
		if err == nil && a.hwdec && j.Kind == "video" && (j.req.Video.Backend == "vaapi" || j.req.Video.Backend == "nvenc") {
			// these chains only work when the GPU really decodes (scale_vaapi/scale_cuda/hwdownload need GPU frames)
			m.update(j, func() { j.DecoderConfirmed, j.DecoderName = true, "hwaccel "+j.req.Video.Backend })
		}
		if err == nil || m.wasCancelled(j) || i == len(attempts)-1 {
			break
		}
		// this way did not work: note it quietly and try the next one
		jlog.Warnf("Auftrag %s: %s nicht möglich, neuer Versuch. ffmpeg: %s", j.ID, a.label, j.Error)
		m.update(j, func() {
			j.Attempts = append(j.Attempts, a.label+" nicht möglich – "+j.Error)
			j.Log = append(j.Log, "--- "+a.label+" fehlgeschlagen, neuer Versuch ---")
			j.Error = ""
		})
	}
	if err != nil {
		cleanup()
		if m.wasCancelled(j) {
			m.update(j, func() { j.Status = "canceled"; j.Ended = time.Now(); j.Error = "" })
			jlog.Infof("Auftrag %s abgebrochen, unfertige Datei gelöscht (%s)", j.ID, filepath.Base(j.item.Path))
			return
		}
		m.fail(j, err)
		return
	}
	if err := os.Rename(tmp, out); err != nil {
		cleanup()
		m.fail(j, err)
		return
	}
	var size int64
	if st, err := os.Stat(out); err == nil {
		size = st.Size()
	}
	o := j.req.Output
	if filepath.Clean(out) != filepath.Clean(j.item.Path) && size > 0 {
		outInfo, perr := m.tools.Probe(context.Background(), out)
		cs := m.verify(ctx, j, info, outInfo, perr, usedArgs, out, j.SizeIn, size)
		ok := allOK(cs)
		m.update(j, func() {
			j.Checks, j.CheckFailed, j.Phase = cs, !ok, ""
			for _, c := range cs {
				if !c.OK {
					j.Warnings = append(j.Warnings, "Prüfung nicht bestanden: "+c.Note+o.keepNote())
					jlog.Warnf("Auftrag %s: Prüfung nicht bestanden: %s", j.ID, c.Note)
				}
			}
		})
		if ok && o.DeleteSource {
			if o.Grace {
				if dst, err := m.trashSource(j.item.Path, o.GraceDays); err != nil {
					m.update(j, func() {
						j.Warnings = append(j.Warnings, "Quelle konnte nicht in die Schonfrist verschoben werden: "+err.Error())
					})
				} else {
					m.update(j, func() { j.Trashed = dst })
				}
			} else if err := os.Remove(j.item.Path); err != nil {
				m.update(j, func() { j.Warnings = append(j.Warnings, "Quelle konnte nicht gelöscht werden: "+err.Error()) })
			}
		}
	}
	var sizeIn int64
	m.update(j, func() {
		j.Status = "done"
		j.Progress = 100
		j.ETA = 0
		j.SizeOut = size
		j.Ended = time.Now()
		sizeIn = j.SizeIn
	})
	m.mu.Lock()
	dur, backend, encoder, decoder := j.Ended.Sub(j.Started).Round(time.Second), j.Backend, j.Encoder, j.Decoder
	m.mu.Unlock()
	jlog.Infof("Auftrag %s fertig in %s: %d → %d Bytes (Schreiben: %s/%s, Lesen: %s)", j.ID, dur, sizeIn, size, backend, encoder, decoder)
	if m.OnDone != nil {
		m.OnDone(j.Kind, sizeIn, size)
	}
}

func (m *Manager) exec(ctx context.Context, j *Job, args []string, duration float64) error {
	cmd := proc.CommandContext(ctx, m.tools.FFmpeg, args...)
	m.update(j, func() { j.Error = "" })
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()
	m.update(j, func() {
		j.Cmd = "ffmpeg " + build.Quote(args)
		j.MapLines = nil
		j.EncoderConfirmed = false
		j.DecoderName, j.DecoderConfirmed = "", false
	})
	if err := cmd.Start(); err != nil {
		return err
	}
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		m.readProgress(j, stdout, duration)
	}()
	go func() {
		defer wg.Done()
		sc := bufio.NewScanner(stderr)
		sc.Buffer(make([]byte, 64*1024), 1024*1024)
		for sc.Scan() {
			line := strings.TrimSpace(sc.Text())
			if line == "" {
				continue
			}
			m.update(j, func() {
				j.Log = append(j.Log, line)
				if len(j.Log) > 200 {
					j.Log = j.Log[len(j.Log)-200:]
				}
				if mapRe.MatchString(line) {
					j.MapLines = append(j.MapLines, line)
					if j.Encoder != "" && strings.Contains(line, "("+j.Encoder+")") {
						j.EncoderConfirmed = true
						// the same line names the decoder: "(hevc (hevc_qsv) -> hevc (hevc_qsv))"
						if name := decoderOf(line); name != "" {
							j.DecoderName = name
							j.DecoderConfirmed = isHWDecoder(name)
						}
					}
				}
			})
		}
	}()
	wg.Wait()
	err := cmd.Wait()
	if err != nil {
		m.update(j, func() {
			tail := j.Log
			if len(tail) > 4 {
				tail = tail[len(tail)-4:]
			}
			j.Error = strings.Join(tail, " | ")
		})
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return fmt.Errorf("ffmpeg: %v", err)
	}
	m.update(j, func() { j.Error = "" })
	return nil
}

func (m *Manager) readProgress(j *Job, r io.Reader, duration float64) {
	sc := bufio.NewScanner(r)
	for sc.Scan() {
		k, v, ok := strings.Cut(sc.Text(), "=")
		if !ok {
			continue
		}
		v = strings.TrimSpace(v)
		m.update(j, func() {
			switch k {
			case "out_time_us", "out_time_ms":
				us, err := strconv.ParseFloat(v, 64)
				if err == nil && duration > 0 && us >= 0 {
					p := us / 1e6 / duration * 100
					if p > 99.9 {
						p = 99.9
					}
					j.Progress = p
					if sp, err := strconv.ParseFloat(strings.TrimSuffix(j.Speed, "x"), 64); err == nil && sp > 0 {
						j.ETA = int((duration - us/1e6) / sp)
					}
				}
			case "fps":
				j.FPS, _ = strconv.ParseFloat(v, 64)
			case "speed":
				j.Speed = v
			}
		})
	}
}

func absf(f float64) float64 {
	if f < 0 {
		return -f
	}
	return f
}

func maxf(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

// missingDirs lists the parts of dir that do not exist yet, deepest first.
func missingDirs(dir string) []string {
	var out []string
	for d := filepath.Clean(dir); ; d = filepath.Dir(d) {
		if _, err := os.Stat(d); err == nil || filepath.Dir(d) == d {
			break
		}
		out = append(out, d)
	}
	return out
}

// removeEmptyDirs removes folders a failed job created, unless another job is still writing below them.
func (m *Manager) removeEmptyDirs(dirs []string, own string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, d := range dirs {
		busy := false
		for out := range m.reserved {
			if out != own && strings.HasPrefix(out, d+string(filepath.Separator)) {
				busy = true
				break
			}
		}
		if busy {
			return
		}
		if os.Remove(d) != nil { // not empty: stop, the parents are not empty either
			return
		}
	}
}

// ---- unfinished files survive a crash/restart: remember them and clean up at the next start ----

// SetPartialLog enables tracking of .part files in file (usually /config/partials.json) and removes
// the ones a previous run left behind. Only files this program created itself are touched.
func (m *Manager) SetPartialLog(file string) (removed int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.partialFile = file
	if file == "" {
		return 0
	}
	var old []string
	if b, err := os.ReadFile(file); err == nil {
		json.Unmarshal(b, &old)
	}
	for _, p := range old {
		if strings.HasSuffix(p, ".part") {
			if os.Remove(p) == nil {
				removed++
				jlog.Warnf("Unfertige Datei eines früheren Laufs entfernt: %s", p)
			}
		}
	}
	m.partials = map[string]bool{}
	m.savePartialsLocked()
	return removed
}

func (m *Manager) trackPartial(path string, on bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.partialFile == "" {
		return
	}
	if on {
		m.partials[path] = true
	} else {
		delete(m.partials, path)
	}
	m.savePartialsLocked()
}

func (m *Manager) savePartialsLocked() {
	list := make([]string, 0, len(m.partials))
	for p := range m.partials {
		list = append(list, p)
	}
	b, _ := json.Marshal(list)
	tmp := m.partialFile + ".tmp"
	if os.WriteFile(tmp, b, 0o644) == nil {
		os.Rename(tmp, m.partialFile)
	}
}

var decRe = regexp.MustCompile(`\(\w+ \(([\w.-]+)\) -> `)

// decoderOf extracts the decoder name from ffmpeg's "Stream mapping" line ("" if absent).
func decoderOf(line string) string {
	if m := decRe.FindStringSubmatch(line); m != nil {
		return m[1]
	}
	return ""
}

// isHWDecoder: ffmpeg names real hardware decoders (…_qsv, …_cuvid) in that line; plain "native" is software
// (VAAPI/CUDA hwaccels are not shown there, so they cannot be confirmed this way).
func isHWDecoder(name string) bool {
	for _, suf := range []string{"_qsv", "_cuvid", "_vaapi", "_amf", "_d3d11va"} {
		if strings.HasSuffix(name, suf) {
			return true
		}
	}
	return false
}

// keepNote tells that the source was left alone because a check failed (only relevant when deleting was wanted).
func (o OutputOpts) keepNote() string {
	if o.DeleteSource {
		return " – Quelle NICHT gelöscht"
	}
	return ""
}
