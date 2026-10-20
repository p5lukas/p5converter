package jobs

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/p5lukas/p5converter/internal/ffmpeg"
)

func TestExpectedCountsAndTracks(t *testing.T) {
	in := &ffmpeg.Info{Streams: []ffmpeg.Stream{{Index: 0, Type: "video"}, {Index: 1, Type: "audio"}, {Index: 2, Type: "audio"}, {Index: 3, Type: "subtitle"}}}
	args := []string{"-i", "x", "-map", "0:0", "-map", "0:1", "-map", "0:t?", "-map", "0:3", "-c", "copy"}
	want := expectedCounts(in, args)
	if want["video"] != 1 || want["audio"] != 1 || want["subtitle"] != 1 {
		t.Fatalf("unerwartet: %v", want)
	}
	good := &ffmpeg.Info{Streams: []ffmpeg.Stream{{Type: "video"}, {Type: "audio"}, {Type: "subtitle"}}}
	if c := checkTracks(want, good); !c.OK {
		t.Errorf("sollte passen: %s", c.Note)
	}
	missing := &ffmpeg.Info{Streams: []ffmpeg.Stream{{Type: "video"}, {Type: "audio"}}}
	if c := checkTracks(want, missing); c.OK {
		t.Errorf("fehlende Untertitelspur nicht erkannt")
	}
}

func TestCheckSizeAndBase(t *testing.T) {
	if c := checkSize(100<<20, 500<<10); c.OK {
		t.Error("winziges Ergebnis nicht erkannt")
	}
	if c := checkSize(100<<20, 30<<20); !c.OK {
		t.Error("normales Ergebnis fälschlich bemängelt")
	}
	if c := checkSize(1000, 1); !c.OK {
		t.Error("sehr kleine Quelle soll nicht geprüft werden")
	}
	if c := checkBase(100, &ffmpeg.Info{Duration: 60}, nil); c.OK {
		t.Error("abweichende Laufzeit nicht erkannt")
	}
	if c := checkBase(100, &ffmpeg.Info{Duration: 100.5}, nil); !c.OK {
		t.Error("passende Laufzeit bemängelt")
	}
}

func TestCheckBigger(t *testing.T) {
	if c := checkBigger(100<<20, 112<<20); c.OK || c.Note == "" {
		t.Error("größeres Ergebnis nicht erkannt")
	}
	if c := checkBigger(100<<20, 100<<20); c.OK {
		t.Error("gleich großes Ergebnis ist kein Gewinn")
	}
	if c := checkBigger(100<<20, 58<<20); !c.OK {
		t.Error("kleineres Ergebnis fälschlich bemängelt")
	}
	if c := checkBigger(1000, 2000); !c.OK {
		t.Error("sehr kleine Quelle soll nicht geprüft werden")
	}
}

func testTools(t *testing.T) ffmpeg.Tools {
	t.Helper()
	tl, err := ffmpeg.Locate("")
	if err != nil {
		t.Skip("ffmpeg nicht installiert")
	}
	return tl
}

// Der Decode-Test muss eine heile Datei bestehen und eine in der Mitte beschädigte finden.
func TestCheckDecodeFindsDamage(t *testing.T) {
	tl := testTools(t)
	dir := t.TempDir()
	good := filepath.Join(dir, "good.mkv")
	if out, err := exec.Command(tl.FFmpeg, "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x240:r=25:d=6",
		"-f", "lavfi", "-i", "sine=f=440:d=6", "-c:v", "libx264", "-g", "10", "-c:a", "aac", good).CombinedOutput(); err != nil {
		t.Fatalf("%v %s", err, out)
	}
	m := &Manager{tools: tl}
	j := &Job{}
	if c := m.checkDecode(context.Background(), j, good, 6); !c.OK {
		t.Fatalf("heile Datei durchgefallen: %s", c.Note)
	}
	b, _ := os.ReadFile(good)
	for i := len(b) / 3; i < len(b)/3+4000 && i < len(b); i++ {
		b[i] ^= 0xA5
	}
	bad := filepath.Join(dir, "bad.mkv")
	os.WriteFile(bad, b, 0o644)
	if c := m.checkDecode(context.Background(), j, bad, 6); c.OK {
		t.Errorf("beschädigte Datei nicht erkannt")
	}
}
