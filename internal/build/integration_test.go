package build

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/p5lukas/p5converter/internal/ffmpeg"
)

// Runs real ffmpeg (software encoders only). Skipped if ffmpeg is missing.
func tools(t *testing.T) ffmpeg.Tools {
	t.Helper()
	tl, err := ffmpeg.Locate("")
	if err != nil {
		t.Skip("ffmpeg nicht installiert")
	}
	return tl
}

func run(t *testing.T, tl ffmpeg.Tools, args ...string) {
	t.Helper()
	if out, err := exec.Command(tl.FFmpeg, append([]string{"-hide_banner", "-v", "error", "-y"}, args...)...).CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg %v: %v\n%s", args, err, out)
	}
}

func makeSource(t *testing.T, tl ffmpeg.Tools, dir string) string {
	t.Helper()
	srt := filepath.Join(dir, "s.srt")
	os.WriteFile(srt, []byte("1\n00:00:00,000 --> 00:00:01,000\nHallo\n"), 0o644)
	src := filepath.Join(dir, "src.mkv")
	run(t, tl, "-f", "lavfi", "-i", "testsrc2=s=640x360:r=25:d=2", "-f", "lavfi", "-i", "sine=f=440:d=2", "-f", "lavfi", "-i", "sine=f=880:d=2",
		"-i", srt, "-map", "0", "-map", "1", "-map", "2", "-map", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p10le",
		"-c:a", "aac", "-c:s", "srt", "-metadata:s:a:0", "language=ger", "-metadata:s:a:1", "language=eng", "-metadata:s:s:0", "language=ger", src)
	return src
}

func TestVideoRealEncodes(t *testing.T) {
	tl := tools(t)
	dir := t.TempDir()
	src := makeSource(t, tl, dir)
	info, err := tl.Probe(context.Background(), src)
	if err != nil {
		t.Fatal(err)
	}
	enc := tl.Encoders()
	cases := []struct {
		name   string
		o      VideoOpts
		ov     Overrides
		need   string
		vcodec string
		pix    string
		height int
		nAudio int
		nSub   int
	}{
		{"x264 8bit scale", VideoOpts{Codec: "h264", Backend: "cpu", CRF: 28, Preset: "veryfast", BitDepth: 8, Height: 180}, Overrides{}, "libx264", "h264", "yuv420p", 180, 2, 1},
		{"x265 10bit", VideoOpts{Codec: "hevc", Backend: "cpu", CRF: 30, Preset: "veryfast", BitDepth: 10}, Overrides{}, "libx265", "hevc", "yuv420p10le", 360, 2, 1},
		{"auto depth keeps 10", VideoOpts{Codec: "hevc", Backend: "cpu", CRF: 30, Preset: "veryfast"}, Overrides{}, "libx265", "hevc", "yuv420p10le", 360, 2, 1},
		{"svt-av1", VideoOpts{Codec: "av1", Backend: "cpu", CRF: 40, Preset: "veryfast", BitDepth: 10}, Overrides{}, "libsvtav1", "av1", "yuv420p10le", 360, 2, 1},
		{"vp9", VideoOpts{Codec: "vp9", Backend: "cpu", CRF: 40, Preset: "veryfast", BitDepth: 8}, Overrides{}, "libvpx-vp9", "vp9", "yuv420p", 360, 2, 1},
		{"copy + lang filter + no subs", VideoOpts{Codec: "copy", AudioLangs: []string{"ger"}, SubMode: "none"}, Overrides{}, "", "h264", "yuv420p10le", 360, 1, 0},
		{"drop audio + audio encode opus", VideoOpts{Codec: "copy", AudioMode: "encode", AudioCodec: "opus", AudioKbps: 96}, Overrides{Drop: []int{1}}, "libopus", "h264", "yuv420p10le", 360, 1, 1},
		{"mp4 container", VideoOpts{Container: "mp4", Codec: "h264", Backend: "cpu", CRF: 30, Preset: "veryfast", BitDepth: 8}, Overrides{}, "libx264", "h264", "yuv420p", 360, 2, 1},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if c.need != "" && !enc[c.need] {
				t.Skip(c.need + " fehlt")
			}
			ext := "mkv"
			if c.o.Container == "mp4" {
				ext = "mp4"
			}
			out := filepath.Join(dir, strings.ReplaceAll(c.name, " ", "_")+"."+ext)
			plan, err := BuildVideo(info, c.o, c.ov, src, out)
			if err != nil {
				t.Fatal(err)
			}
			if o, err := exec.Command(tl.FFmpeg, plan.Args...).CombinedOutput(); err != nil {
				t.Fatalf("%v\n%s\nargs: %s", err, o, Quote(plan.Args))
			}
			oi, err := tl.Probe(context.Background(), out)
			if err != nil {
				t.Fatal(err)
			}
			v := oi.FirstVideo()
			if v.Codec != c.vcodec || v.PixFmt != c.pix || v.Height != c.height {
				t.Errorf("video: %s %s %dp, erwartet %s %s %dp", v.Codec, v.PixFmt, v.Height, c.vcodec, c.pix, c.height)
			}
			if n := len(oi.ByType("audio")); n != c.nAudio {
				t.Errorf("audio spuren %d, erwartet %d", n, c.nAudio)
			}
			if n := len(oi.ByType("subtitle")); n != c.nSub {
				t.Errorf("untertitel %d, erwartet %d", n, c.nSub)
			}
			if oi.Duration < 1.5 {
				t.Errorf("duration %.2f", oi.Duration)
			}
		})
	}
}

func TestAudioRealEncodes(t *testing.T) {
	tl := tools(t)
	dir := t.TempDir()
	flac := filepath.Join(dir, "song.flac")
	cover := filepath.Join(dir, "c.jpg")
	run(t, tl, "-f", "lavfi", "-i", "testsrc=s=200x200:d=1", "-frames:v", "1", cover)
	run(t, tl, "-f", "lavfi", "-i", "sine=f=440:d=2", "-i", cover, "-map", "0", "-map", "1", "-c:a", "flac", "-c:v", "mjpeg",
		"-disposition:v", "attached_pic", "-metadata", "artist=Band", "-metadata", "title=Lied", flac)
	// ogg source keeps tags on the stream (not in format) – tests TagsInStream
	ogg := filepath.Join(dir, "src.ogg")
	run(t, tl, "-i", flac, "-vn", "-c:a", "libvorbis", "-metadata", "artist=Band2", "-metadata", "title=Lied2", ogg)

	enc := tl.Encoders()
	for _, f := range []struct{ format, encoder string }{{"mp3", "libmp3lame"}, {"ogg", "libvorbis"}, {"opus", "libopus"}, {"m4a", "aac"}, {"flac", "flac"}, {"wav", "pcm_s16le"}} {
		for _, srcName := range []string{flac, ogg} {
			t.Run(f.format+"_from_"+filepath.Ext(srcName), func(t *testing.T) {
				if !enc[f.encoder] {
					t.Skip()
				}
				info, err := tl.Probe(context.Background(), srcName)
				if err != nil {
					t.Fatal(err)
				}
				out := filepath.Join(dir, "o_"+filepath.Ext(srcName)[1:]+"."+AudioExt(f.format))
				args, err := BuildAudio(info, AudioOpts{Format: f.format, Mode: "vbr", Quality: 4, Bitrate: 128, KeepCover: true, SampleRate: 44100, Channels: 2}, srcName, out)
				if err != nil {
					t.Fatal(err)
				}
				if o, err := exec.Command(tl.FFmpeg, args...).CombinedOutput(); err != nil {
					t.Fatalf("%v\n%s\n%s", err, o, Quote(args))
				}
				oi, err := tl.Probe(context.Background(), out)
				if err != nil {
					t.Fatal(err)
				}
				if f.format != "wav" && oi.Tags["artist"] == "" {
					t.Errorf("Tags verloren: %v", oi.Tags)
				}
				if oi.Duration < 1.5 {
					t.Errorf("duration %.2f", oi.Duration)
				}
			})
		}
	}
}

// Real file: title, ISO 639-2 language, forced flag and the single default audio track must come out of ffmpeg as set.
func TestTrackEditsRealFile(t *testing.T) {
	tl := tools(t)
	dir := t.TempDir()
	src := makeSource(t, tl, dir)
	info, err := tl.Probe(context.Background(), src)
	if err != nil {
		t.Fatal(err)
	}
	str := func(s string) *string { return &s }
	yes := true
	ov := Overrides{Tracks: map[string]TrackEdit{
		"1": {Title: str("Deutsch Stereo"), Lang: str("de")},
		"2": {Title: str("English"), Lang: str("en"), Default: &yes},
		"3": {Title: str("Deutsch (Forced)"), Forced: &yes},
	}}
	out := filepath.Join(dir, "out.mkv")
	p, err := BuildVideo(info, VideoOpts{Codec: "copy", Container: "mkv", AudioMode: "copy", SubMode: "copy"}, ov, src, out)
	if err != nil {
		t.Fatal(err)
	}
	if o, err := exec.Command(tl.FFmpeg, p.Args...).CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg: %v\n%s", err, o)
	}
	got, err := tl.Probe(context.Background(), out)
	if err != nil {
		t.Fatal(err)
	}
	a, s := got.ByType("audio"), got.ByType("subtitle")
	if len(a) != 2 || len(s) != 1 {
		t.Fatalf("Spuren: %d Audio, %d Untertitel", len(a), len(s))
	}
	if a[0].Title != "Deutsch Stereo" || a[0].Lang != "ger" || a[0].Default {
		t.Errorf("Audio 1: %+v", a[0])
	}
	if a[1].Title != "English" || a[1].Lang != "eng" || !a[1].Default {
		t.Errorf("Audio 2: %+v", a[1])
	}
	if s[0].Title != "Deutsch (Forced)" || !s[0].Forced {
		t.Errorf("Untertitel: %+v", s[0])
	}
}

// Dateien mit Anhängen (Schriften für ASS-Untertitel): der Anhang kommt als letzte Spur, sonst lehnt der Matroska-Muxer von ffmpeg 6.1
// die kopierten Tonspuren ab und die Umwandlung bricht nach 0 Bildern ab. Regression (Chernobyl, ASS mit Schrift).
func TestAttachmentsDoNotBreakMuxing(t *testing.T) {
	tl := tools(t)
	dir := t.TempDir()
	font := filepath.Join(dir, "font.ttf")
	os.WriteFile(font, []byte("kein echter Font, nur Bytes"), 0o644)
	src := filepath.Join(dir, "att.mkv")
	run(t, tl, "-f", "lavfi", "-i", "testsrc2=s=320x180:r=25:d=2", "-f", "lavfi", "-i", "sine=f=440:d=2", "-f", "lavfi", "-i", "sine=f=880:d=2",
		"-map", "0", "-map", "1", "-map", "2", "-c:v", "libx264", "-c:a", "ac3", "-attach", font, "-metadata:s:t", "mimetype=application/x-truetype-font", src)
	info, err := tl.Probe(context.Background(), src)
	if err != nil {
		t.Fatal(err)
	}
	for name, o := range map[string]VideoOpts{
		"Video kopieren, Ton kopieren": {Codec: "copy", Container: "mkv", AudioMode: "copy", SubMode: "copy"},
		"x264, Ton kopieren":           {Codec: "h264", Backend: "cpu", CRF: 30, Preset: "ultrafast", Container: "mkv", AudioMode: "copy", SubMode: "copy"},
		"x264, Ton umwandeln":          {Codec: "h264", Backend: "cpu", CRF: 30, Preset: "ultrafast", Container: "mkv", AudioMode: "encode", AudioCodec: "eac3", AudioKbps: 256, SubMode: "copy"},
	} {
		t.Run(name, func(t *testing.T) {
			if o.Codec == "h264" && !tl.Encoders()["libx264"] {
				t.Skip("libx264 fehlt")
			}
			out := filepath.Join(dir, strings.ReplaceAll(name, " ", "_")+".mkv")
			p, err := BuildVideo(info, o, Overrides{}, src, out)
			if err != nil {
				t.Fatal(err)
			}
			last := ""
			for i, a := range p.Args {
				if a == "-map" && i+1 < len(p.Args) {
					last = p.Args[i+1]
				}
			}
			if last != "0:t?" {
				t.Errorf("Anhänge müssen die letzte Spur sein, die letzte Map ist %q: %v", last, p.Args)
			}
			if o, err := exec.Command(tl.FFmpeg, p.Args...).CombinedOutput(); err != nil {
				t.Fatalf("ffmpeg: %v\n%s", err, o)
			}
			got, err := tl.Probe(context.Background(), out)
			if err != nil {
				t.Fatal(err)
			}
			var att, aud int
			for _, s := range got.Streams {
				switch s.Type {
				case "attachment":
					att++
				case "audio":
					aud++
				}
			}
			if att != 1 || aud != 2 {
				t.Errorf("Ausgabe: %d Anhänge, %d Tonspuren (erwartet 1 und 2)", att, aud)
			}
		})
	}
}
