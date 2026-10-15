package build

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/p5lukas/p5converter/internal/ffmpeg"
)

type VideoOpts struct {
	Container   string `json:"container"` // mkv | mp4
	Codec       string `json:"codec"`     // copy | h264 | hevc | av1 | vp9
	Backend     string `json:"backend"`   // cpu | qsv | nvenc | vaapi | amf
	VaapiDevice string `json:"vaapiDevice"`
	CRF         int    `json:"crf"`
	Preset      string `json:"preset"`   // slow | medium | fast | veryfast
	BitDepth    int    `json:"bitDepth"` // 0 = like source, 8, 10
	Height      int    `json:"height"`   // 0 = keep; never upscales
	HWDecode    bool   `json:"hwDecode"`
	// HWDecodeMode picks how hardware-decoded Quick Sync frames are handled (set by the job runner, never by the
	// client): "" or "full" = the whole chain stays on the GPU (vpp_qsv), "download" = frames are copied back to
	// normal memory (hwdownload) before the software filters.
	HWDecodeMode string `json:"-"`
	AV1Aom       bool   `json:"av1Aom"` // use libaom instead of SVT-AV1 on cpu
	// HWInit are extra ffmpeg input options found by the hardware detection (e.g. Quick Sync via a VAAPI device).
	// Set by the server, never by the client.
	HWInit     []string `json:"-"`
	AudioMode  string   `json:"audioMode"` // copy | encode
	AudioCodec string   `json:"audioCodec"`
	AudioKbps  int      `json:"audioKbps"` // per stereo pair
	AudioLangs []string `json:"audioLangs"`
	SubMode    string   `json:"subMode"` // copy | none
	SubLangs   []string `json:"subLangs"`
}

// Overrides are per-file track decisions made in the UI.
type Overrides struct {
	Drop         []int `json:"drop"`         // absolute stream indices to remove
	DefaultAudio *int  `json:"defaultAudio"` // absolute stream index to flag default
}

type Plan struct {
	Args     []string
	Encoder  string // video encoder name or "copy"
	Backend  string
	TenBit   bool
	Warnings []string
}

var encoderNames = map[string]map[string]string{
	"cpu":   {"h264": "libx264", "hevc": "libx265", "av1": "libsvtav1", "vp9": "libvpx-vp9"},
	"qsv":   {"h264": "h264_qsv", "hevc": "hevc_qsv", "av1": "av1_qsv", "vp9": "vp9_qsv"},
	"nvenc": {"h264": "h264_nvenc", "hevc": "hevc_nvenc", "av1": "av1_nvenc"},
	"vaapi": {"h264": "h264_vaapi", "hevc": "hevc_vaapi", "av1": "av1_vaapi", "vp9": "vp9_vaapi"},
	"amf":   {"h264": "h264_amf", "hevc": "hevc_amf", "av1": "av1_amf"},
}

// EncoderName returns the ffmpeg encoder for codec/backend ("" if unsupported).
func EncoderName(backend, codec string) string { return encoderNames[backend][codec] }

var langAlias = map[string]string{
	"de": "ger", "deu": "ger", "ger": "ger", "en": "eng", "eng": "eng", "fr": "fre", "fra": "fre", "fre": "fre",
	"es": "spa", "spa": "spa", "it": "ita", "ita": "ita", "ja": "jpn", "jpn": "jpn", "ru": "rus", "rus": "rus",
	"pt": "por", "por": "por", "nl": "dut", "nld": "dut", "dut": "dut", "pl": "pol", "pol": "pol", "tr": "tur",
	"tur": "tur", "zh": "chi", "zho": "chi", "chi": "chi", "ko": "kor", "kor": "kor", "sv": "swe", "swe": "swe",
}

func normLang(l string) string {
	l = strings.ToLower(strings.TrimSpace(l))
	if v, ok := langAlias[l]; ok {
		return v
	}
	return l
}

func langKept(lang string, want []string) bool {
	if len(want) == 0 {
		return true
	}
	l := normLang(lang)
	if l == "" || l == "und" {
		return true
	}
	for _, w := range want {
		if normLang(w) == l {
			return true
		}
	}
	return false
}

func contains(list []int, v int) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func isTextSub(codec string) bool {
	switch codec {
	case "subrip", "srt", "ass", "ssa", "mov_text", "webvtt", "text":
		return true
	}
	return false
}

func BuildVideo(info *ffmpeg.Info, o VideoOpts, ov Overrides, in, out string) (*Plan, error) {
	vs := info.FirstVideo()
	if vs == nil {
		return nil, fmt.Errorf("keine Videospur gefunden")
	}
	if o.Container == "" {
		o.Container = "mkv"
	}
	if o.Backend == "" {
		o.Backend = "cpu"
	}
	plan := &Plan{Backend: o.Backend}
	copyVideo := o.Codec == "copy"
	hw := o.Backend != "cpu" && !copyVideo
	if copyVideo {
		plan.Backend = "copy"
	}

	args := []string{"-hide_banner", "-nostdin", "-y", "-progress", "pipe:1", "-nostats"}

	// --- device / hardware decode (input options) ---
	if hw {
		args = append(args, o.HWInit...)
		if o.Backend == "vaapi" {
			dev := o.VaapiDevice
			if dev == "" {
				dev = "/dev/dri/renderD128"
			}
			args = append(args, "-vaapi_device", dev)
		}
		if o.HWDecode {
			switch o.Backend {
			case "qsv":
				args = append(args, "-hwaccel", "qsv", "-hwaccel_output_format", "qsv")
				if len(o.HWInit) > 0 {
					args = append(args, "-hwaccel_device", "hw")
				}
			case "nvenc":
				args = append(args, "-hwaccel", "cuda")
			case "vaapi":
				args = append(args, "-hwaccel", "vaapi")
			case "amf":
				args = append(args, "-hwaccel", "d3d11va")
			}
		}
	}
	args = append(args, "-i", in, "-map_metadata", "0", "-map_chapters", "0")

	// --- video ---
	args = append(args, "-map", "0:"+strconv.Itoa(vs.Index))
	if copyVideo {
		args = append(args, "-c:v", "copy")
		plan.Encoder = "copy"
	} else {
		enc := EncoderName(o.Backend, o.Codec)
		if o.Backend == "cpu" && o.Codec == "av1" && o.AV1Aom {
			enc = "libaom-av1"
		}
		if enc == "" {
			return nil, fmt.Errorf("%s unterstützt %s nicht", o.Backend, o.Codec)
		}
		plan.Encoder = enc

		ten := o.BitDepth == 10 || (o.BitDepth == 0 && vs.BitDepth > 8)
		if ten && (o.Codec == "h264" && o.Backend != "cpu" || o.Codec == "vp9" && o.Backend != "cpu") {
			plan.Warnings = append(plan.Warnings, "10 Bit mit "+enc+" nicht möglich – verwende 8 Bit")
			ten = false
		}
		if ten && o.Backend == "nvenc" && o.Codec == "h264" {
			ten = false
		}
		plan.TenBit = ten

		var vf []string
		scaleH, scaleW := 0, 0
		if o.Height > 0 && vs.Height > 0 {
			if o.Height < vs.Height {
				scaleH = o.Height
				scaleW = (vs.Width*o.Height/vs.Height + 1) / 2 * 2
				vf = append(vf, fmt.Sprintf("scale=-2:%d", o.Height))
			} else if o.Height > vs.Height {
				plan.Warnings = append(plan.Warnings, "Quelle ist kleiner als Zielauflösung – keine Hochskalierung")
			}
		}
		hwPix := "nv12"
		swPix := "yuv420p"
		if ten {
			hwPix, swPix = "p010le", "yuv420p10le"
		}
		crf := strconv.Itoa(o.CRF)
		if o.CRF <= 0 {
			crf = "23"
		}
		pi := presetIndex(o.Preset) // 0 slow .. 3 veryfast
		enargs := []string{"-c:v", enc}

		switch o.Backend {
		case "cpu":
			vf = append(vf, "format="+swPix)
			switch o.Codec {
			case "h264":
				enargs = append(enargs, "-preset", []string{"slow", "medium", "fast", "veryfast"}[pi], "-crf", crf)
				if ten {
					enargs = append(enargs, "-profile:v", "high10")
				}
			case "hevc":
				enargs = append(enargs, "-preset", []string{"slow", "medium", "fast", "veryfast"}[pi], "-crf", crf)
				if o.Container == "mp4" {
					enargs = append(enargs, "-tag:v", "hvc1")
				}
			case "av1":
				if enc == "libaom-av1" {
					enargs = append(enargs, "-crf", crf, "-b:v", "0", "-cpu-used", []string{"2", "4", "6", "8"}[pi], "-row-mt", "1")
				} else {
					enargs = append(enargs, "-preset", []string{"4", "6", "8", "10"}[pi], "-crf", crf)
				}
			case "vp9":
				enargs = append(enargs, "-crf", crf, "-b:v", "0", "-row-mt", "1", "-cpu-used", []string{"1", "2", "3", "4"}[pi])
			}
		case "qsv":
			switch {
			case !o.HWDecode:
				vf = append(vf, "format="+hwPix)
			case o.HWDecodeMode == "download":
				// frames live on the GPU: copy them back, then the normal software filters apply
				srcFmt := "nv12"
				if vs.BitDepth > 8 {
					srcFmt = "p010le"
				}
				vf = append([]string{"hwdownload", "format=" + srcFmt}, vf...)
				vf = append(vf, "format="+hwPix)
			default:
				// whole chain on the GPU: software filters cannot read Quick Sync frames
				vf = nil
				var vpp []string
				if scaleH > 0 && scaleW > 0 {
					vpp = append(vpp, fmt.Sprintf("w=%d", scaleW), fmt.Sprintf("h=%d", scaleH))
				}
				if (vs.BitDepth > 8) != ten {
					vpp = append(vpp, "format="+hwPix)
				}
				if len(vpp) > 0 {
					vf = []string{"vpp_qsv=" + strings.Join(vpp, ":")}
				}
			}
			enargs = append(enargs, "-preset", []string{"slow", "medium", "fast", "veryfast"}[pi], "-global_quality", crf)
			if ten && o.Codec == "hevc" {
				enargs = append(enargs, "-profile:v", "main10")
			}
		case "nvenc":
			vf = append(vf, "format="+hwPix)
			enargs = append(enargs, "-preset", []string{"p6", "p5", "p4", "p2"}[pi], "-rc", "vbr", "-cq", crf, "-b:v", "0")
			if ten && o.Codec == "hevc" {
				enargs = append(enargs, "-profile:v", "main10")
			}
		case "vaapi":
			vf = append(vf, "format="+hwPix, "hwupload")
			enargs = append(enargs, "-qp", crf)
			if ten && o.Codec == "hevc" {
				enargs = append(enargs, "-profile:v", "main10")
			}
		case "amf":
			vf = append(vf, "format="+hwPix)
			enargs = append(enargs, "-quality", []string{"quality", "quality", "balanced", "speed"}[pi], "-rc", "cqp",
				"-qp_i", crf, "-qp_p", crf)
			if o.Codec == "h264" {
				enargs = append(enargs, "-qp_b", crf)
			}
			if ten && o.Codec == "hevc" {
				enargs = append(enargs, "-profile:v", "main10")
			}
		default:
			return nil, fmt.Errorf("unbekanntes Backend %q", o.Backend)
		}
		if len(vf) > 0 {
			args = append(args, "-vf", strings.Join(vf, ","))
		}
		args = append(args, enargs...)
	}
	if o.Container == "mkv" {
		args = append(args, "-map", "0:t?", "-c:t", "copy") // fonts for styled subtitles
	}

	// --- audio ---
	var audio []ffmpeg.Stream
	for _, s := range info.ByType("audio") {
		if !contains(ov.Drop, s.Index) {
			audio = append(audio, s)
		}
	}
	if len(o.AudioLangs) > 0 {
		var kept []ffmpeg.Stream
		for _, s := range audio {
			if langKept(s.Lang, o.AudioLangs) {
				kept = append(kept, s)
			}
		}
		if len(kept) == 0 && len(audio) > 0 {
			plan.Warnings = append(plan.Warnings, "Sprachfilter würde alle Audiospuren entfernen – Filter ignoriert")
		} else {
			audio = kept
		}
	}
	for i, s := range audio {
		args = append(args, "-map", "0:"+strconv.Itoa(s.Index))
		n := strconv.Itoa(i)
		if o.AudioMode == "encode" {
			ch := s.Channels
			if ch <= 0 {
				ch = 2
			}
			br := o.AudioKbps
			if br <= 0 {
				br = 160
			}
			if ch > 2 {
				br = br * ch / 2
				if br > 640 {
					br = 640
				}
			}
			codec := map[string]string{"aac": "aac", "opus": "libopus", "ac3": "ac3", "eac3": "eac3", "flac": "flac", "mp3": "libmp3lame"}[o.AudioCodec]
			if codec == "" {
				codec = "aac"
			}
			args = append(args, "-c:a:"+n, codec)
			if codec != "flac" {
				args = append(args, "-b:a:"+n, strconv.Itoa(br)+"k")
			}
			if codec == "libopus" && ch == 6 {
				args = append(args, "-filter:a:"+n, "aformat=channel_layouts=5.1")
			} else if codec == "libopus" && ch == 8 {
				args = append(args, "-filter:a:"+n, "aformat=channel_layouts=7.1")
			}
		} else {
			args = append(args, "-c:a:"+n, "copy")
		}
		if ov.DefaultAudio != nil {
			if s.Index == *ov.DefaultAudio {
				args = append(args, "-disposition:a:"+n, "default")
			} else {
				args = append(args, "-disposition:a:"+n, "0")
			}
		}
	}

	// --- subtitles ---
	if o.SubMode != "none" {
		n := 0
		for _, s := range info.ByType("subtitle") {
			if contains(ov.Drop, s.Index) || !langKept(s.Lang, o.SubLangs) {
				continue
			}
			if o.Container == "mp4" && !isTextSub(s.Codec) {
				plan.Warnings = append(plan.Warnings, fmt.Sprintf("Untertitel #%d (%s) passt nicht in MP4 – entfernt", s.Index, s.Codec))
				continue
			}
			args = append(args, "-map", "0:"+strconv.Itoa(s.Index))
			if o.Container == "mp4" {
				args = append(args, "-c:s:"+strconv.Itoa(n), "mov_text")
			} else {
				args = append(args, "-c:s:"+strconv.Itoa(n), "copy")
			}
			n++
		}
	}

	muxer := "matroska"
	if o.Container == "mp4" {
		muxer = "mp4"
		args = append(args, "-movflags", "+faststart")
	}
	args = append(args, "-f", muxer, out)
	plan.Args = args
	return plan, nil
}

func presetIndex(p string) int {
	switch p {
	case "slow":
		return 0
	case "fast":
		return 2
	case "veryfast":
		return 3
	}
	return 1
}

func Quote(args []string) string {
	var b strings.Builder
	for i, a := range args {
		if i > 0 {
			b.WriteByte(' ')
		}
		if strings.ContainsAny(a, " \t'\"()") {
			b.WriteString("'" + strings.ReplaceAll(a, "'", `'\''`) + "'")
		} else {
			b.WriteString(a)
		}
	}
	return b.String()
}
