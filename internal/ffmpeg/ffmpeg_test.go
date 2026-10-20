package ffmpeg

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestStatTag(t *testing.T) {
	if statTag(map[string]string{"number_of_frames": " 42 "}, "number_of_frames") != 42 {
		t.Error("plain tag")
	}
	if statTag(map[string]string{"number_of_bytes-eng": "1234"}, "number_of_bytes") != 1234 {
		t.Error("tag with language suffix")
	}
	if statTag(map[string]string{"bps-eng": "640000"}, "bps") != 640000 {
		t.Error("BPS tag (stream bitrate in MKV)")
	}
	if statTag(map[string]string{"title": "x"}, "number_of_frames") != 0 {
		t.Error("missing tag must be 0")
	}
}

// mkvmerge writes the statistics tags into MKV files (here set by hand); the probe must return them for subtitles.
func TestProbeSubtitleSize(t *testing.T) {
	tl, err := Locate("")
	if err != nil {
		t.Skip("ffmpeg nicht installiert")
	}
	dir := t.TempDir()
	srt := func(name string, lines int) string {
		p := filepath.Join(dir, name)
		var b []byte
		for i := 1; i <= lines; i++ {
			b = append(b, []byte(
				itoa(i)+"\n00:00:"+pad(i%60)+",000 --> 00:00:"+pad(i%60)+",500\nZeile "+itoa(i)+"\n\n")...)
		}
		os.WriteFile(p, b, 0o644)
		return p
	}
	full, forced := srt("full.srt", 40), srt("forced.srt", 3)
	out := filepath.Join(dir, "x.mkv")
	args := []string{"-v", "error", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=60:r=1", "-i", full, "-i", forced,
		"-map", "0", "-map", "1", "-map", "2", "-c:v", "libx264", "-c:s", "srt",
		"-metadata:s:s:0", "NUMBER_OF_FRAMES-eng=40", "-metadata:s:s:0", "NUMBER_OF_BYTES-eng=900",
		"-metadata:s:s:1", "NUMBER_OF_FRAMES=3", "-metadata:s:s:1", "NUMBER_OF_BYTES=60", "-y", out}
	if b, err := exec.Command(tl.FFmpeg, args...).CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg: %v %s", err, b)
	}
	info, err := tl.Probe(context.Background(), out)
	if err != nil {
		t.Fatal(err)
	}
	var subs []Stream
	for _, s := range info.Streams {
		if s.Type == "subtitle" {
			subs = append(subs, s)
		}
	}
	if len(subs) != 2 {
		t.Fatalf("2 Untertitel erwartet, %d gefunden", len(subs))
	}
	if subs[0].Frames != 40 || subs[1].Frames != 3 || subs[0].Bytes <= subs[1].Bytes {
		t.Errorf("Zählwerte falsch: %+v / %+v", subs[0], subs[1])
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	s := ""
	for ; n > 0; n /= 10 {
		s = string(rune('0'+n%10)) + s
	}
	return s
}

func pad(n int) string {
	if n < 10 {
		return "0" + itoa(n)
	}
	return itoa(n)
}
