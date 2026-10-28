package build

import (
	"strings"
	"testing"

	"github.com/p5lukas/p5converter/internal/ffmpeg"
)

func sample() *ffmpeg.Info {
	return &ffmpeg.Info{Streams: []ffmpeg.Stream{
		{Index: 0, Type: "video", Codec: "h264", Width: 1920, Height: 1080, BitDepth: 8},
		{Index: 1, Type: "audio", Codec: "dts", Lang: "ger", Channels: 6},
		{Index: 2, Type: "audio", Codec: "ac3", Lang: "eng", Channels: 2},
		{Index: 3, Type: "subtitle", Codec: "hdmv_pgs_subtitle", Lang: "ger"},
		{Index: 4, Type: "subtitle", Codec: "subrip", Lang: "eng"},
	}}
}

func join(a []string) string { return " " + strings.Join(a, " ") + " " }

func TestVideoVariants(t *testing.T) {
	cases := []struct {
		name string
		o    VideoOpts
		ov   Overrides
		want []string
		not  []string
	}{
		{"x265 10bit", VideoOpts{Codec: "hevc", Backend: "cpu", CRF: 22, BitDepth: 10, Preset: "slow"}, Overrides{},
			[]string{"-c:v libx265", "-crf 22", "format=yuv420p10le", "-preset slow", "-c:a:0 copy", "-c:s:1 copy", "-f matroska"}, nil},
		{"qsv hevc", VideoOpts{Codec: "hevc", Backend: "qsv", CRF: 24, HWDecode: true, BitDepth: 10}, Overrides{},
			[]string{"-hwaccel qsv", "-c:v hevc_qsv", "-global_quality 24", "format=p010le", "-profile:v main10"}, []string{"-crf"}},
		{"nvenc", VideoOpts{Codec: "h264", Backend: "nvenc", CRF: 23, BitDepth: 10}, Overrides{},
			[]string{"-c:v h264_nvenc", "-cq 23", "format=nv12"}, []string{"p010le"}},
		{"vaapi", VideoOpts{Codec: "hevc", Backend: "vaapi", VaapiDevice: "/dev/dri/renderD129", CRF: 25}, Overrides{},
			[]string{"-vaapi_device /dev/dri/renderD129", "format=nv12,hwupload", "-c:v hevc_vaapi", "-qp 25"}, nil},
		{"scale no upscale", VideoOpts{Codec: "h264", Backend: "cpu", Height: 2160}, Overrides{}, nil, []string{"scale="}},
		{"scale down", VideoOpts{Codec: "h264", Backend: "cpu", Height: 720}, Overrides{}, []string{"scale=-2:720,format=yuv420p"}, nil},
		{"lang filter + no subs", VideoOpts{Codec: "copy", AudioLangs: []string{"de"}, SubMode: "none"}, Overrides{},
			[]string{"-map 0:1", "-c:v copy"}, []string{"-map 0:2", "-map 0:3", "-map 0:4"}},
		{"drop + default", VideoOpts{Codec: "copy"}, Overrides{Drop: []int{1}, DefaultAudio: ptr(2)},
			[]string{"-map 0:2", "-disposition:a:0 default"}, []string{"-map 0:1 "}},
		{"audio encode", VideoOpts{Codec: "copy", AudioMode: "encode", AudioCodec: "opus", AudioKbps: 128}, Overrides{},
			[]string{"-c:a:0 libopus", "-b:a:0 384k", "channel_layouts=5.1", "-b:a:1 128k"}, nil},
		{"mp4 drops pgs", VideoOpts{Codec: "copy", Container: "mp4"}, Overrides{},
			[]string{"-c:s:0 mov_text", "-movflags +faststart"}, []string{"-map 0:3"}},
	}
	for _, c := range cases {
		p, err := BuildVideo(sample(), c.o, c.ov, "in.mkv", "out.part")
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		s := join(p.Args)
		for _, w := range c.want {
			if !strings.Contains(s, w) {
				t.Errorf("%s: missing %q in%s", c.name, w, s)
			}
		}
		for _, w := range c.not {
			if strings.Contains(s, w) {
				t.Errorf("%s: unexpected %q in%s", c.name, w, s)
			}
		}
	}
}

func ptr(i int) *int { return &i }

func TestQSVInitArgs(t *testing.T) {
	init := []string{"-init_hw_device", "vaapi=va:/dev/dri/renderD128", "-init_hw_device", "qsv=hw@va"}
	p, err := BuildVideo(sample(), VideoOpts{Codec: "hevc", Backend: "qsv", CRF: 24, HWDecode: true, HWInit: init}, Overrides{}, "in.mkv", "out.part")
	if err != nil {
		t.Fatal(err)
	}
	s := join(p.Args)
	for _, w := range []string{"-init_hw_device vaapi=va:/dev/dri/renderD128", "-init_hw_device qsv=hw@va", "-hwaccel qsv", "-hwaccel_device hw", "-c:v hevc_qsv"} {
		if !strings.Contains(s, w) {
			t.Errorf("fehlt %q in%s", w, s)
		}
	}
	// the init options must come before the input
	if strings.Index(s, "-init_hw_device") > strings.Index(s, " -i ") {
		t.Error("init-Optionen müssen vor -i stehen")
	}
	// no init -> unchanged behaviour
	p2, _ := BuildVideo(sample(), VideoOpts{Codec: "hevc", Backend: "qsv", CRF: 24, HWDecode: true}, Overrides{}, "in.mkv", "out.part")
	if strings.Contains(join(p2.Args), "hwaccel_device") || strings.Contains(join(p2.Args), "init_hw_device") {
		t.Error("ohne Init keine Zusatzoptionen")
	}
}

func TestQSVDecodeModes(t *testing.T) {
	base := VideoOpts{Codec: "hevc", Backend: "qsv", CRF: 20, HWDecode: true, Height: 720, BitDepth: 10}
	// full: the chain stays on the GPU, no software filter may see Quick Sync frames
	p, err := BuildVideo(sample(), base, Overrides{}, "in.mkv", "out.part")
	if err != nil {
		t.Fatal(err)
	}
	s := join(p.Args)
	for _, w := range []string{"-hwaccel qsv", "-hwaccel_output_format qsv", "vpp_qsv=w=", ":h=720", "format=p010le", "-c:v hevc_qsv"} {
		if !strings.Contains(s, w) {
			t.Errorf("full: fehlt %q in%s", w, s)
		}
	}
	if strings.Contains(s, "scale=") || strings.Contains(s, "hwdownload") {
		t.Errorf("full: kein Software-Filter erlaubt:%s", s)
	}
	// download: frames are copied back before the software filters
	base.HWDecodeMode = "download"
	p, _ = BuildVideo(sample(), base, Overrides{}, "in.mkv", "out.part")
	s = join(p.Args)
	for _, w := range []string{"-hwaccel_output_format qsv", "hwdownload,format=", "scale=-2:720", "format=p010le"} {
		if !strings.Contains(s, w) {
			t.Errorf("download: fehlt %q in%s", w, s)
		}
	}
	// software decoding: no hwaccel at all, plain software filters
	base.HWDecode = false
	p, _ = BuildVideo(sample(), base, Overrides{}, "in.mkv", "out.part")
	s = join(p.Args)
	if strings.Contains(s, "-hwaccel") || !strings.Contains(s, "scale=-2:720,format=p010le") {
		t.Errorf("software:%s", s)
	}
	// nothing to filter on the GPU: no -vf at all
	p, _ = BuildVideo(sample(), VideoOpts{Codec: "hevc", Backend: "qsv", CRF: 20, HWDecode: true, BitDepth: 8}, Overrides{}, "in.mkv", "out.part")
	if strings.Contains(join(p.Args), " -vf ") {
		t.Errorf("ohne Skalierung/Formatwechsel kein -vf:%s", join(p.Args))
	}
}

func TestTrackEditsAndMetadata(t *testing.T) {
	str := func(s string) *string { return &s }
	yes := true
	info := &ffmpeg.Info{Streams: []ffmpeg.Stream{
		{Index: 0, Type: "video", Codec: "hevc", Width: 1920, Height: 1080, BitDepth: 8},
		{Index: 1, Type: "audio", Codec: "eac3", Lang: "ger", Channels: 6, Default: true},
		{Index: 2, Type: "audio", Codec: "dts", Lang: "eng", Channels: 6},
		{Index: 3, Type: "subtitle", Codec: "subrip", Lang: "ger"},
		{Index: 4, Type: "subtitle", Codec: "subrip", Lang: "eng", Forced: true},
		{Index: 5, Type: "subtitle", Codec: "hdmv_pgs_subtitle", Lang: "fre"},
	}}
	ov := Overrides{Tracks: map[string]TrackEdit{
		"1": {Title: str("Deutsch 5.1"), Lang: str("de")},
		"2": {Action: "encode", Codec: "opus", Kbps: 96, Title: str("English (Opus)"), Default: &yes},
		"3": {Forced: &yes, Title: str("Deutsch (Forced)")},
		"5": {Action: "drop"},
	}}
	p, err := BuildVideo(info, VideoOpts{Codec: "copy", Container: "mkv", AudioMode: "copy", SubMode: "copy"}, ov, "in.mkv", "out.part")
	if err != nil {
		t.Fatal(err)
	}
	s := join(p.Args)
	for _, w := range []string{
		"-c:a:0 copy", "-metadata:s:a:0 title=Deutsch 5.1", "-metadata:s:a:0 language=ger", // 2-letter input is written as ISO 639-2
		"-c:a:1 libopus", "-b:a:1 288k", "-metadata:s:a:1 title=English (Opus)", // 96 kbit per stereo pair x 3 for 5.1
		"-disposition:a:1 default", "-disposition:a:0 0", // default moves to the second track
		"-c:s:0 copy", "-disposition:s:0 forced", "-metadata:s:s:0 title=Deutsch (Forced)",
	} {
		if !strings.Contains(s, w) {
			t.Errorf("fehlt %q in%s", w, s)
		}
	}
	if strings.Contains(s, "-map 0:5") {
		t.Errorf("verworfene Spur wurde gemappt:%s", s)
	}
	// forced in MP4: Plex does not read it -> warning
	p, _ = BuildVideo(info, VideoOpts{Codec: "copy", Container: "mp4", AudioMode: "copy", SubMode: "copy"}, ov, "in.mkv", "out.part")
	found := false
	for _, w := range p.Warnings {
		if strings.Contains(w, "nur in MKV") {
			found = true
		}
	}
	if !found {
		t.Errorf("Warnung zu Forced in MP4 fehlt: %v", p.Warnings)
	}
	// an invalid language code is ignored with a warning, never written
	bad := Overrides{Tracks: map[string]TrackEdit{"1": {Lang: str("deutsch!")}}}
	p, _ = BuildVideo(info, VideoOpts{Codec: "copy", Container: "mkv"}, bad, "in.mkv", "out.part")
	if strings.Contains(join(p.Args), "language=") || len(p.Warnings) == 0 {
		t.Errorf("ungültige Sprache: %s %v", join(p.Args), p.Warnings)
	}
	// explicit "copy" beats "remove all subtitles" and the language filter
	keep := Overrides{Tracks: map[string]TrackEdit{"4": {Action: "copy"}}}
	p, _ = BuildVideo(info, VideoOpts{Codec: "copy", Container: "mkv", SubMode: "none", AudioLangs: []string{"ger"}}, keep, "in.mkv", "out.part")
	s = join(p.Args)
	if !strings.Contains(s, "-map 0:4") || strings.Contains(s, "-map 0:3") || strings.Contains(s, "-map 0:2") {
		t.Errorf("explizite Wahl vs. allgemeine Regeln:%s", s)
	}
}

func TestVaapiAndNvencDecodeChains(t *testing.T) {
	src := sample()
	for _, c := range []struct {
		backend, codec, accel, scale string
	}{{"vaapi", "hevc", "-hwaccel vaapi", "scale_vaapi="}, {"nvenc", "hevc", "-hwaccel cuda", "scale_cuda="}} {
		// full: frames stay on the GPU, a software filter would break it
		p, err := BuildVideo(src, VideoOpts{Codec: c.codec, Backend: c.backend, CRF: 24, HWDecode: true, Height: 360, BitDepth: 10}, Overrides{}, "in.mkv", "out.part")
		if err != nil {
			t.Fatal(err)
		}
		s := join(p.Args)
		for _, w := range []string{c.accel, "-hwaccel_output_format", c.scale, ":h=360:format="} {
			if !strings.Contains(s, w) {
				t.Errorf("%s full: fehlt %q in%s", c.backend, w, s)
			}
		}
		if strings.Contains(s, "hwdownload") || strings.Contains(s, " scale=") {
			t.Errorf("%s full: kein Software-Filter erlaubt:%s", c.backend, s)
		}
		// download: back to normal memory, then the software filters
		p, _ = BuildVideo(src, VideoOpts{Codec: c.codec, Backend: c.backend, CRF: 24, HWDecode: true, HWDecodeMode: "download", Height: 360}, Overrides{}, "in.mkv", "out.part")
		s = join(p.Args)
		if !strings.Contains(s, "hwdownload,format=") || !strings.Contains(s, "scale=-2:360") {
			t.Errorf("%s download:%s", c.backend, s)
		}
		// software reading: no hwaccel at all
		p, _ = BuildVideo(src, VideoOpts{Codec: c.codec, Backend: c.backend, CRF: 24, Height: 360}, Overrides{}, "in.mkv", "out.part")
		if strings.Contains(join(p.Args), "-hwaccel ") {
			t.Errorf("%s ohne HW-Decoding darf kein hwaccel stehen", c.backend)
		}
	}
}

// Quick Sync Lesen unter Windows mit zwei Grafikeinheiten: der beim Test gefundene Adapter ersetzt die Geräteoptionen des Schreibens, aber nur für das
// Hardware-Lesen; beim Lesen mit der CPU bleibt es bei den Optionen für das Schreiben.
func TestQSVDecodeUsesDetectedAdapter(t *testing.T) {
	enc := []string{"-init_hw_device", "qsv=hw"}
	dec := []string{"-init_hw_device", "qsv=hw:hw_any,child_device=1,child_device_type=d3d11va"}
	o := VideoOpts{Codec: "hevc", Backend: "qsv", CRF: 20, HWDecode: true, BitDepth: 8, HWInit: enc, HWDecodeInit: dec}
	p, err := BuildVideo(sample(), o, Overrides{}, "in.mkv", "out.part")
	if err != nil {
		t.Fatal(err)
	}
	s := join(p.Args)
	if !strings.Contains(s, "child_device=1,child_device_type=d3d11va") || strings.Contains(s, "-init_hw_device qsv=hw ") ||
		!strings.Contains(s, "-hwaccel qsv") || !strings.Contains(s, "-hwaccel_device hw") {
		t.Errorf("Lesen mit Adapter 1:%s", s)
	}
	// Lesen mit der CPU: nur die Optionen für das Schreiben, kein Adapter für das Lesen
	o.HWDecode = false
	p, _ = BuildVideo(sample(), o, Overrides{}, "in.mkv", "out.part")
	s = join(p.Args)
	if strings.Contains(s, "child_device") || !strings.Contains(s, "-init_hw_device qsv=hw") || strings.Contains(s, "-hwaccel") {
		t.Errorf("Lesen mit der CPU:%s", s)
	}
	// ohne eigenen Lese-Adapter bleibt alles wie bisher
	o.HWDecode, o.HWDecodeInit = true, nil
	p, _ = BuildVideo(sample(), o, Overrides{}, "in.mkv", "out.part")
	if s = join(p.Args); strings.Contains(s, "child_device") || !strings.Contains(s, "-hwaccel_device hw") {
		t.Errorf("ohne Lese-Adapter:%s", s)
	}
	// nur bei Quick Sync (NVENC bleibt unberührt)
	p, _ = BuildVideo(sample(), VideoOpts{Codec: "hevc", Backend: "nvenc", CRF: 20, HWDecode: true, BitDepth: 8, HWDecodeInit: dec}, Overrides{}, "in.mkv", "out.part")
	if strings.Contains(join(p.Args), "child_device") {
		t.Errorf("NVENC darf den Lese-Adapter nicht bekommen:%s", join(p.Args))
	}
}
