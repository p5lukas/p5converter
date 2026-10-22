package jobs

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/p5lukas/p5converter/internal/build"
	"github.com/p5lukas/p5converter/internal/ffmpeg"
	"github.com/p5lukas/p5converter/internal/hw"
	"github.com/p5lukas/p5converter/internal/rename"
)

func TestOutputPathPatternAndRules(t *testing.T) {
	info := &ffmpeg.Info{Tags: map[string]string{"title": "Der Flug"},
		Streams: []ffmpeg.Stream{{Type: "video", Codec: "hevc", Height: 1080, Width: 1920, BitDepth: 8}}}
	j := &Job{Kind: "video", item: Item{Path: "/in/Show [WEBDL-1080p].mkv"}, req: &Request{
		Video: build.VideoOpts{Codec: "hevc", Container: "mkv", Height: 720, BitDepth: 10},
		Output: OutputOpts{Dir: "/out", Pattern: "{filename} [{res}][{codec}][{bit}]", Suffix: "_x",
			Replace: []rename.Rule{{Find: "[WEBDL-1080p]", With: "WEB"}}}}}
	got := outputPath(j, info)
	want := filepath.FromSlash("/out/Show WEB [720p][x265][10bit]_x.mkv")
	if got != want {
		t.Errorf("%q, erwartet %q", got, want)
	}
	// only rules, no pattern
	j.req.Output.Pattern = ""
	if got := outputPath(j, info); got != filepath.FromSlash("/out/Show WEB_x.mkv") {
		t.Errorf("nur Regeln: %q", got)
	}
	// nothing set: like before (source name, never the source path itself)
	j.req.Output = OutputOpts{}
	j.item.Path = "/in/a.mp4"
	j.req.Video.Container = "mp4"
	if got := outputPath(j, info); got != filepath.FromSlash("/in/a (konvertiert).mp4") {
		t.Errorf("Standard: %q", got)
	}
}

func TestOutputPathKeepStructure(t *testing.T) {
	info := &ffmpeg.Info{Streams: []ffmpeg.Stream{{Type: "video", Codec: "h264", Height: 1080}}}
	j := &Job{Kind: "video", item: Item{Path: "/video2/Show/Season 01/a.mkv", Rel: "Show/Season 01/a.mkv"}, req: &Request{
		Video:  build.VideoOpts{Codec: "hevc", Container: "mkv"},
		Output: OutputOpts{Dir: "/out", Structure: "keep"}}}
	if got := outputPath(j, info); got != filepath.FromSlash("/out/Show/Season 01/a.mkv") {
		t.Errorf("Struktur: %q", got)
	}
	// ein Muster mit Unterordnern ersetzt die Struktur statt sie zu verdoppeln
	j.req.Output.Pattern = "Serien/{filename}"
	if got := outputPath(j, info); got != filepath.FromSlash("/out/Serien/a.mkv") {
		t.Errorf("Muster mit Ordner: %q", got)
	}
	j.req.Output.Structure = "flat"
	if got := outputPath(j, info); got != filepath.FromSlash("/out/Serien/a.mkv") {
		t.Errorf("flach: %q", got)
	}
}

// A fake ffmpeg that refuses everything with hardware decoding: the job must quietly fall through
// the Quick Sync variants to software decoding and end up "done" without a leftover error.
func TestHWDecodeFallbackIsQuiet(t *testing.T) {
	real, err := ffmpeg.Locate("")
	if err != nil {
		t.Skip("ffmpeg nicht installiert")
	}
	dir := t.TempDir()
	src := filepath.Join(dir, "in.mkv")
	if out, err := exec.Command(real.FFmpeg, "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=1:size=320x240:rate=10", "-c:v", "libx264", src).CombinedOutput(); err != nil {
		t.Fatalf("Testvideo: %v %s", err, out)
	}
	logf := filepath.Join(dir, "calls.log")
	fake := filepath.Join(dir, "ffmpeg")
	script := "#!/bin/sh\necho \"$@\" >> " + logf + "\ncase \"$*\" in *-hwaccel*) echo 'Error while filtering: Function not implemented' >&2; exit 1;; esac\nfor a; do last=$a; done\necho x > \"$last\"\nexit 0\n"
	if err := os.WriteFile(fake, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	m := New(ffmpeg.Tools{FFmpeg: fake, FFprobe: real.FFprobe}, hw.NewSampler(), 1)
	ids := m.Submit(&Request{Kind: "video", Items: []Item{{Path: src}},
		Video:  build.VideoOpts{Container: "mkv", Codec: "hevc", Backend: "qsv", CRF: 24, HWDecode: true, Height: 120, BitDepth: 10},
		Output: OutputOpts{Dir: filepath.Join(dir, "out"), Exists: "rename"}})
	var j Job
	for i := 0; i < 100; i++ {
		time.Sleep(100 * time.Millisecond)
		if s := m.Snapshot(); len(s) == 1 && (s[0].Status == "done" || s[0].Status == "error") {
			j = s[0]
			break
		}
	}
	if len(ids) != 1 || j.Status != "done" {
		t.Fatalf("Status %q, Fehler %q", j.Status, j.Error)
	}
	if j.Error != "" || j.Decoder != "software" || !j.HWDecodeFallback || len(j.Attempts) != 2 {
		t.Errorf("Anzeige: error=%q decoder=%q fallback=%v attempts=%v", j.Error, j.Decoder, j.HWDecodeFallback, j.Attempts)
	}
	b, _ := os.ReadFile(logf)
	calls := strings.Split(strings.TrimSpace(string(b)), "\n")
	if len(calls) != 3 || !strings.Contains(calls[0], "vpp_qsv") || !strings.Contains(calls[1], "hwdownload") || strings.Contains(calls[2], "-hwaccel") {
		t.Errorf("Reihenfolge der Versuche:\n%s", b)
	}
}

// helpers: a real test video/audio plus a fake ffmpeg (script) that behaves as the test needs
func testMedia(t *testing.T) (real ffmpeg.Tools, video, audio string) {
	t.Helper()
	real, err := ffmpeg.Locate("")
	if err != nil {
		t.Skip("ffmpeg nicht installiert")
	}
	dir := t.TempDir()
	video, audio = filepath.Join(dir, "in.mkv"), filepath.Join(dir, "in.mp3")
	for _, a := range [][]string{
		{"-f", "lavfi", "-i", "testsrc=duration=1:size=320x240:rate=10", "-c:v", "libx264", video},
		{"-f", "lavfi", "-i", "sine=duration=1", audio},
	} {
		if out, err := exec.Command(real.FFmpeg, append([]string{"-loglevel", "error"}, a...)...).CombinedOutput(); err != nil {
			t.Fatalf("Testdatei: %v %s", err, out)
		}
	}
	return real, video, audio
}

func fakeFFmpeg(t *testing.T, body string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "ffmpeg")
	if err := os.WriteFile(p, []byte("#!/bin/sh\n"+body+"\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	return p
}

func waitJobs(m *Manager, n int, done func(Job) bool) []Job {
	for i := 0; i < 150; i++ {
		time.Sleep(100 * time.Millisecond)
		s := m.Snapshot()
		ok := len(s) == n
		for _, j := range s {
			ok = ok && done(j)
		}
		if ok {
			return s
		}
	}
	return m.Snapshot()
}

// audio and video have their own queue: a long video job must not hold back audio jobs
func TestQueuesAreSeparatePerWorld(t *testing.T) {
	real, video, audio := testMedia(t)
	fake := fakeFFmpeg(t, "for a; do last=$a; done\ncase \"$*\" in *matroska*) sleep 3;; esac\necho x > \"$last\"")
	m := New(ffmpeg.Tools{FFmpeg: fake, FFprobe: real.FFprobe}, hw.NewSampler(), 1)
	out := OutputOpts{Dir: t.TempDir(), Exists: "rename"}
	m.Submit(&Request{Kind: "video", Items: []Item{{Path: video}}, Video: build.VideoOpts{Container: "mkv", Codec: "copy"}, Output: out})
	m.Submit(&Request{Kind: "audio", Items: []Item{{Path: audio}}, Audio: build.AudioOpts{Format: "mp3", Mode: "cbr", Bitrate: 128}, Output: out})
	var audioDone, videoRunning bool
	for i := 0; i < 20 && !audioDone; i++ {
		time.Sleep(100 * time.Millisecond)
		for _, j := range m.Snapshot() {
			if j.Kind == "audio" && j.Status == "done" {
				audioDone = true
			}
			if j.Kind == "video" && j.Status == "running" {
				videoRunning = true
			}
		}
	}
	if !audioDone || !videoRunning {
		t.Fatalf("Audio muss neben dem laufenden Video-Auftrag fertig werden (audio fertig=%v, video läuft=%v)", audioDone, videoRunning)
	}
	// cancel / clear only touch their own world
	m.CancelAll("audio")
	m.ClearFinished("audio")
	var kinds []string
	for _, j := range m.Snapshot() {
		kinds = append(kinds, j.Kind)
	}
	if len(kinds) != 1 || kinds[0] != "video" {
		t.Errorf("Aufräumen nur für Audio: übrig %v", kinds)
	}
	m.CancelAll("")
	m.SetConcurrency("audio", 3)
	if m.Concurrency("audio") != 3 || m.Concurrency("video") != 1 {
		t.Errorf("Parallelität je Welt: audio=%d video=%d", m.Concurrency("audio"), m.Concurrency("video"))
	}
}

// a failed or canceled job leaves no .part file and no empty folder it created itself
func TestFailedJobCleansUp(t *testing.T) {
	real, video, _ := testMedia(t)
	fake := fakeFFmpeg(t, "for a; do last=$a; done\necho partial > \"$last\"\nexit 1")
	m := New(ffmpeg.Tools{FFmpeg: fake, FFprobe: real.FFprobe}, hw.NewSampler(), 1)
	base := t.TempDir()
	keep := filepath.Join(base, "vorhanden")
	os.MkdirAll(keep, 0o755)
	target := filepath.Join(keep, "neu", "unterordner")
	m.Submit(&Request{Kind: "video", Items: []Item{{Path: video}}, Video: build.VideoOpts{Container: "mkv", Codec: "copy"},
		Output: OutputOpts{Dir: target, Exists: "rename"}})
	s := waitJobs(m, 1, func(j Job) bool { return j.Status == "error" })
	if s[0].Status != "error" {
		t.Fatalf("Status %q", s[0].Status)
	}
	if _, err := os.Stat(filepath.Join(keep, "neu")); err == nil {
		t.Error("vom Auftrag angelegte Ordner blieben stehen")
	}
	if _, err := os.Stat(keep); err != nil {
		t.Error("ein schon vorhandener Ordner darf nicht gelöscht werden")
	}
}

// .part files of a run that crashed are removed at the next start – and only those we recorded
func TestPartialFilesRemovedAtStart(t *testing.T) {
	dir := t.TempDir()
	leftover := filepath.Join(dir, "film.mkv.part")
	other := filepath.Join(dir, "wichtig.mkv")
	os.WriteFile(leftover, []byte("x"), 0o644)
	os.WriteFile(other, []byte("y"), 0o644)
	logf := filepath.Join(dir, "partials.json")
	os.WriteFile(logf, []byte(`["`+leftover+`","`+other+`"]`), 0o644) // a non-.part entry must never be deleted
	m := New(ffmpeg.Tools{}, hw.NewSampler(), 1)
	if n := m.SetPartialLog(logf); n != 1 {
		t.Errorf("entfernt: %d", n)
	}
	if _, err := os.Stat(leftover); err == nil {
		t.Error(".part-Rest wurde nicht entfernt")
	}
	if _, err := os.Stat(other); err != nil {
		t.Error("eine Datei ohne .part wurde gelöscht")
	}
	if b, _ := os.ReadFile(logf); string(b) != "[]" {
		t.Errorf("Protokoll nicht geleert: %s", b)
	}
}

func TestDecoderOfMappingLine(t *testing.T) {
	cases := []struct {
		line string
		name string
		hw   bool
	}{
		{"Stream #0:0 -> #0:0 (hevc (hevc_qsv) -> hevc (hevc_qsv))", "hevc_qsv", true},
		{"Stream #0:0 -> #0:0 (hevc (native) -> hevc (hevc_qsv))", "native", false},
		{"Stream #0:0 -> #0:0 (h264 (native) -> hevc (libx265))", "native", false},
		{"Stream #0:1 -> #0:1 (copy)", "", false},
	}
	for _, c := range cases {
		n := decoderOf(c.line)
		if n != c.name || (n != "" && isHWDecoder(n) != c.hw) {
			t.Errorf("%q: %q hw=%v", c.line, n, isHWDecoder(n))
		}
	}
}

// finished conversions are reported with their sizes (feeds the "gewonnener Platz" total); failures are not
func TestOnDoneReportsSizes(t *testing.T) {
	real, video, _ := testMedia(t)
	fake := fakeFFmpeg(t, "for a; do last=$a; done\nprintf 'abcd' > \"$last\"")
	m := New(ffmpeg.Tools{FFmpeg: fake, FFprobe: real.FFprobe}, hw.NewSampler(), 1)
	type rec struct {
		kind    string
		in, out int64
	}
	got := make(chan rec, 4)
	m.OnDone = func(k string, in, out int64) { got <- rec{k, in, out} }
	m.Submit(&Request{Kind: "video", Items: []Item{{Path: video}}, Video: build.VideoOpts{Container: "mkv", Codec: "copy"},
		Output: OutputOpts{Dir: t.TempDir(), Exists: "rename"}})
	select {
	case r := <-got:
		st, _ := os.Stat(video)
		if r.kind != "video" || r.in != st.Size() || r.out != 4 {
			t.Errorf("%+v (Quelle %d Bytes)", r, st.Size())
		}
	case <-time.After(10 * time.Second):
		t.Fatal("OnDone wurde nicht aufgerufen")
	}
}

func TestSnapshotStripsFinishedAndPrunes(t *testing.T) {
	m := &Manager{reserved: map[string]string{}, concurrency: map[string]int{}, running: map[string]int{}}
	for i := 0; i < maxKept+20; i++ {
		m.jobs = append(m.jobs, &Job{ID: fmt.Sprint("j", i), Status: "done", Cmd: "ffmpeg", Log: []string{"a"}, MapLines: []string{"b"}})
	}
	m.jobs = append(m.jobs, &Job{ID: "run", Status: "running", Cmd: "ffmpeg", Log: []string{"a"}}, &Job{ID: "q", Status: "queued"})
	m.finish(m.jobs[0])
	s := m.Snapshot()
	if len(s) != maxKept+2 {
		t.Fatalf("erwartet %d Aufträge, %d erhalten", maxKept+2, len(s))
	}
	if s[0].ID != "j20" {
		t.Errorf("die ältesten beendeten müssen entfallen, erster ist %s", s[0].ID)
	}
	for _, j := range s {
		switch j.Status {
		case "done":
			if j.Cmd != "" || len(j.Log) != 0 || len(j.MapLines) != 0 {
				t.Fatalf("beendeter Auftrag %s trägt noch Log/Befehl", j.ID)
			}
		case "running":
			if j.Cmd == "" || len(j.Log) != 1 {
				t.Fatalf("laufender Auftrag verliert Log/Befehl")
			}
		}
	}
	if m.Finished() != 1 {
		t.Errorf("Finished()=%d", m.Finished())
	}
}
