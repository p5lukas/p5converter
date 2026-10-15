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
