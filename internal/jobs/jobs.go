// Package jobs runs the conversion queue.
package jobs

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/p5lukas/p5converter/internal/build"
	"github.com/p5lukas/p5converter/internal/ffmpeg"
	"github.com/p5lukas/p5converter/internal/hw"
)

type Item struct {
	Path      string          `json:"path"`
	Rel       string          `json:"rel"` // path relative to the added folder (for "keep structure")
	Overrides build.Overrides `json:"overrides"`
}

type OutputOpts struct {
	Dir          string `json:"dir"`       // "" = next to source
	Structure    string `json:"structure"` // flat | keep
	Suffix       string `json:"suffix"`
	Pattern      string `json:"pattern"` // audio only, e.g. {artist}/{album}/{track} - {title}
	Exists       string `json:"exists"`  // skip | overwrite | rename
	DeleteSource bool   `json:"deleteSource"`
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
	EncoderConfirmed bool      `json:"encoderConfirmed"`
	HWDecodeFallback bool      `json:"hwDecodeFallback"`
	Cmd              string    `json:"cmd"`
	Error            string    `json:"error,omitempty"`
	Warnings         []string  `json:"warnings,omitempty"`
	MapLines         []string  `json:"mapLines,omitempty"`
	Log              []string  `json:"log,omitempty"`
	SizeIn           int64     `json:"sizeIn"`
	SizeOut          int64     `json:"sizeOut"`
	Created          time.Time `json:"created"`
	Started          time.Time `json:"started"`
	Ended            time.Time `json:"ended"`

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
	concurrency int
	running     int
}

func New(t ffmpeg.Tools, s *hw.Sampler, concurrency int) *Manager {
	m := &Manager{tools: t, sampler: s, concurrency: concurrency}
	go m.samplerLoop()
	return m
}

func (m *Manager) samplerLoop() {
	for {
		time.Sleep(1500 * time.Millisecond)
		m.mu.Lock()
		r := m.running
		m.mu.Unlock()
		if r > 0 {
			m.sampler.Sample()
		}
	}
}

func (m *Manager) SetConcurrency(n int) {
	if n < 1 {
		n = 1
	}
	if n > 8 {
		n = 8
	}
	m.mu.Lock()
	m.concurrency = n
	m.mu.Unlock()
	m.schedule()
}

func (m *Manager) Concurrency() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.concurrency
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

func (m *Manager) CancelAll() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, j := range m.jobs {
		m.cancelLocked(j)
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

func (m *Manager) ClearFinished() {
	m.mu.Lock()
	defer m.mu.Unlock()
	var keep []*Job
	for _, j := range m.jobs {
		if j.Status == "queued" || j.Status == "running" {
			keep = append(keep, j)
		}
	}
	m.jobs = keep
}

func (m *Manager) schedule() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for m.running < m.concurrency {
		var next *Job
		for _, j := range m.jobs {
			if j.Status == "queued" {
				next = j
				break
			}
		}
		if next == nil {
			return
		}
		next.Status = "running"
		next.Started = time.Now()
		m.running++
		go func(j *Job) {
			m.run(j)
			m.mu.Lock()
			m.running--
			m.mu.Unlock()
			m.schedule()
		}(next)
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

func (m *Manager) fail(j *Job, err error) {
	m.update(j, func() {
		j.Status = "error"
		j.Error = err.Error()
		j.Ended = time.Now()
	})
}

var invalidChars = strings.NewReplacer("/", "_", "\\", "_", ":", "_", "*", "_", "?", "_", "\"", "_", "<", "_", ">", "_", "|", "_")

func safe(s string) string {
	s = strings.TrimSpace(invalidChars.Replace(s))
	return strings.Trim(s, ". ")
}

var patRe = regexp.MustCompile(`\{(\w+)\}`)

func applyPattern(pat string, info *ffmpeg.Info, in string) string {
	return patRe.ReplaceAllStringFunc(pat, func(m string) string {
		key := m[1 : len(m)-1]
		var v string
		switch key {
		case "filename":
			v = strings.TrimSuffix(filepath.Base(in), filepath.Ext(in))
		case "track", "disc":
			t := info.Tags[key]
			if key == "disc" && t == "" {
				t = info.Tags["discnumber"]
			}
			if key == "track" && t == "" {
				t = info.Tags["tracknumber"]
			}
			t, _, _ = strings.Cut(t, "/")
			if n, err := strconv.Atoi(strings.TrimSpace(t)); err == nil {
				if key == "track" {
					return fmt.Sprintf("%02d", n)
				}
				return strconv.Itoa(n)
			}
			return ""
		case "year":
			v = info.Tags["date"]
			if v == "" {
				v = info.Tags["year"]
			}
			if len(v) > 4 {
				v = v[:4]
			}
		case "albumartist":
			v = info.Tags["album_artist"]
			if v == "" {
				v = info.Tags["albumartist"]
			}
			if v == "" {
				v = info.Tags["artist"]
			}
		default:
			v = info.Tags[key]
		}
		v = safe(v)
		if v == "" {
			v = "Unbekannt"
		}
		return v
	})
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
	base := strings.TrimSuffix(filepath.Base(in), filepath.Ext(in)) + o.Suffix
	if j.Kind == "audio" && o.Pattern != "" {
		p := applyPattern(o.Pattern, info, in)
		parts := strings.Split(filepath.ToSlash(p), "/")
		for i, s := range parts {
			parts[i] = safe(s)
		}
		rel := filepath.Join(parts...)
		if rel != "" {
			if o.Dir == "" {
				dir = filepath.Dir(in)
			}
			dir = filepath.Join(dir, filepath.Dir(rel))
			base = strings.TrimLeft(filepath.Base(rel), " -") + o.Suffix
		}
	}
	out := filepath.Join(dir, base+"."+ext)
	if filepath.Clean(out) == filepath.Clean(in) {
		out = filepath.Join(dir, base+" (konvertiert)."+ext)
	}
	return out
}

func freeName(p string) string {
	ext := filepath.Ext(p)
	base := strings.TrimSuffix(p, ext)
	for i := 2; ; i++ {
		c := fmt.Sprintf("%s (%d)%s", base, i, ext)
		if _, err := os.Stat(c); os.IsNotExist(err) {
			return c
		}
	}
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
	out := outputPath(j, info)
	if _, err := os.Stat(out); err == nil {
		switch j.req.Output.Exists {
		case "skip":
			m.update(j, func() {
				j.Status = "skipped"
				j.Output = out
				j.Ended = time.Now()
				j.Error = "Zieldatei existiert bereits"
			})
			return
		case "overwrite":
		default:
			out = freeName(out)
		}
	}
	m.update(j, func() { j.Output = out })
	if err := os.MkdirAll(filepath.Dir(out), 0o755); err != nil {
		m.fail(j, err)
		return
	}
	tmp := out + ".part"

	buildArgs := func(hwdec bool) ([]string, error) {
		if j.Kind == "audio" {
			return build.BuildAudio(info, j.req.Audio, j.item.Path, tmp)
		}
		v := j.req.Video
		v.HWDecode = v.HWDecode && hwdec
		plan, err := build.BuildVideo(info, v, j.item.Overrides, j.item.Path, tmp)
		if err != nil {
			return nil, err
		}
		m.update(j, func() {
			j.Backend, j.Encoder, j.Warnings = plan.Backend, plan.Encoder, plan.Warnings
		})
		return plan.Args, nil
	}

	args, err := buildArgs(true)
	if err != nil {
		m.fail(j, err)
		return
	}
	err = m.exec(ctx, j, args, info.Duration)
	if err != nil && !m.wasCancelled(j) && j.Kind == "video" && j.req.Video.HWDecode && j.req.Video.Backend != "cpu" && j.req.Video.Codec != "copy" {
		m.update(j, func() {
			j.HWDecodeFallback = true
			j.Log = append(j.Log, "--- Fehler mit HW-Decoding, neuer Versuch ohne HW-Decoding ---")
			j.Progress = 0
		})
		if args2, e2 := buildArgs(false); e2 == nil {
			err = m.exec(ctx, j, args2, info.Duration)
		}
	}
	if err != nil {
		os.Remove(tmp)
		if m.wasCancelled(j) {
			m.update(j, func() { j.Status = "canceled"; j.Ended = time.Now() })
			return
		}
		m.fail(j, err)
		return
	}
	if err := os.Rename(tmp, out); err != nil {
		os.Remove(tmp)
		m.fail(j, err)
		return
	}
	var size int64
	if st, err := os.Stat(out); err == nil {
		size = st.Size()
	}
	m.update(j, func() {
		j.Status = "done"
		j.Progress = 100
		j.ETA = 0
		j.SizeOut = size
		j.Ended = time.Now()
	})
	if j.req.Output.DeleteSource && filepath.Clean(out) != filepath.Clean(j.item.Path) && size > 0 {
		if err := os.Remove(j.item.Path); err != nil {
			m.update(j, func() { j.Warnings = append(j.Warnings, "Quelle konnte nicht gelöscht werden: "+err.Error()) })
		}
	}
}

func (m *Manager) exec(ctx context.Context, j *Job, args []string, duration float64) error {
	cmd := exec.CommandContext(ctx, m.tools.FFmpeg, args...)
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()
	m.update(j, func() {
		j.Cmd = "ffmpeg " + build.Quote(args)
		j.MapLines = nil
		j.EncoderConfirmed = false
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
