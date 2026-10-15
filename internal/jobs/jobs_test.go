package jobs

import (
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
