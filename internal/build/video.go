package build

import (
	"fmt"
	"regexp"
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

// TrackEdit is what the person decided for ONE track of one file (key: absolute stream index).
type TrackEdit struct {
	Action  string  `json:"action"`  // "" = follow the general rules | copy | encode (audio) | drop
	Codec   string  `json:"codec"`   // encode: aac | opus | ac3 | eac3 | flac | mp3 (empty = general setting)
	Kbps    int     `json:"kbps"`    // encode: bit rate per stereo pair (0 = general setting)
	Title   *string `json:"title"`   // nil = keep the original title, "" = remove it
	Lang    *string `json:"lang"`    // nil = keep; otherwise 2/3 letter code, written as ISO 639-2 (what Plex reads)
	Forced  *bool   `json:"forced"`  // nil = keep the original flag
	Default *bool   `json:"default"` // nil = keep the original flag
}

// Overrides are per-file track decisions made in the UI.
type Overrides struct {
	Drop         []int                `json:"drop"`         // absolute stream indices to remove
	DefaultAudio *int                 `json:"defaultAudio"` // absolute stream index to flag default
	Tracks       map[string]TrackEdit `json:"tracks"`       // per track edits, key = absolute stream index
}

func (ov Overrides) edit(index int) TrackEdit { return ov.Tracks[strconv.Itoa(index)] }

var langRe = regexp.MustCompile(`^[a-z]{3}$`)

// iso639 turns a 2/3 letter language input into the 3 letter ISO 639-2 code Plex and other players read ("" = invalid).
func iso639(l string) string {
	n := normLang(l)
	if langRe.MatchString(n) {
		return n
	}
	return ""
}

var audioCodecs = map[string]string{"aac": "aac", "opus": "libopus", "ac3": "ac3", "eac3": "eac3", "flac": "flac", "mp3": "libmp3lame"}

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
	"da": "dan", "dan": "dan", "no": "nor", "nor": "nor", "nb": "nor", "nob": "nor", "fi": "fin", "fin": "fin", "cs": "cze", "ces": "cze", "cze": "cze",
	"hu": "hun", "hun": "hun", "el": "gre", "ell": "gre", "gre": "gre", "ar": "ara", "ara": "ara", "hi": "hin", "hin": "hin",
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
				args = append(args, "-hwaccel", "cuda", "-hwaccel_output_format", "cuda")
			case "vaapi":
				dev := o.VaapiDevice
				if dev == "" {
					dev = "/dev/dri/renderD128"
				}
				args = append(args, "-hwaccel", "vaapi", "-hwaccel_device", dev, "-hwaccel_output_format", "vaapi")
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
			if o.HWDecode {
				vf = gpuChain(o.HWDecodeMode, "cuda", vs, scaleW, scaleH, hwPix, ten, vf)
			} else {
				vf = append(vf, "format="+hwPix)
			}
			enargs = append(enargs, "-preset", []string{"p6", "p5", "p4", "p2"}[pi], "-rc", "vbr", "-cq", crf, "-b:v", "0")
			if ten && o.Codec == "hevc" {
				enargs = append(enargs, "-profile:v", "main10")
			}
		case "vaapi":
			if o.HWDecode {
				vf = gpuChain(o.HWDecodeMode, "vaapi", vs, scaleW, scaleH, hwPix, ten, vf)
			} else {
				vf = append(vf, "format="+hwPix, "hwupload")
			}
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
		e := ov.edit(s.Index)
		if contains(ov.Drop, s.Index) || e.Action == "drop" {
			continue
		}
		if len(o.AudioLangs) > 0 && e.Action == "" && !langKept(s.Lang, o.AudioLangs) {
			continue // explicit choices ("copy"/"encode") beat the language filter
		}
		audio = append(audio, s)
	}
	if len(audio) == 0 && len(info.ByType("audio")) > 0 {
		// everything removed by the general rules: keep the language filter from silencing the file
		if len(o.AudioLangs) > 0 {
			plan.Warnings = append(plan.Warnings, "Sprachfilter würde alle Audiospuren entfernen – Filter ignoriert")
			for _, s := range info.ByType("audio") {
				e := ov.edit(s.Index)
				if !contains(ov.Drop, s.Index) && e.Action != "drop" {
					audio = append(audio, s)
				}
			}
		}
		if len(audio) == 0 {
			plan.Warnings = append(plan.Warnings, "Alle Audiospuren sind abgewählt – die Datei hat keinen Ton")
		}
	}
	anyDefault := false
	for _, s := range audio {
		if d := ov.edit(s.Index).Default; d != nil && *d {
			anyDefault = true
		}
	}
	for i, s := range audio {
		args = append(args, "-map", "0:"+strconv.Itoa(s.Index))
		n := strconv.Itoa(i)
		e := ov.edit(s.Index)
		encode := o.AudioMode == "encode"
		switch e.Action {
		case "encode":
			encode = true
		case "copy":
			encode = false
		}
		if encode {
			ch := s.Channels
			if ch <= 0 {
				ch = 2
			}
			br := o.AudioKbps
			if e.Kbps > 0 {
				br = e.Kbps
			}
			if br <= 0 {
				br = 160
			}
			if ch > 2 {
				br = br * ch / 2
				if br > 640 {
					br = 640
				}
			}
			name := o.AudioCodec
			if e.Codec != "" {
				name = e.Codec
			}
			codec := audioCodecs[name]
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
		args = append(args, trackMeta("a", n, s, e, plan, o.Container)...)
		def, hasDef := s.Default, false
		if ov.DefaultAudio != nil {
			def, hasDef = s.Index == *ov.DefaultAudio, true
		} else if anyDefault {
			def, hasDef = false, true // another track became the default: clear the old flag, one default only
		}
		if e.Default != nil {
			def, hasDef = *e.Default, true
		}
		if hasDef || e.Forced != nil {
			args = append(args, "-disposition:a:"+n, dispositionValue(def, forcedOf(s, e)))
		}
	}

	// --- subtitles ---
	n := 0
	for _, s := range info.ByType("subtitle") {
		e := ov.edit(s.Index)
		if contains(ov.Drop, s.Index) || e.Action == "drop" {
			continue
		}
		if e.Action == "" && (o.SubMode == "none" || !langKept(s.Lang, o.SubLangs)) {
			continue // explicit "copy" beats "remove all" and the language filter
		}
		if o.Container == "mp4" && !isTextSub(s.Codec) {
			plan.Warnings = append(plan.Warnings, fmt.Sprintf("Untertitel #%d (%s) passt nicht in MP4 – entfernt", s.Index, s.Codec))
			continue
		}
		args = append(args, "-map", "0:"+strconv.Itoa(s.Index))
		sn := strconv.Itoa(n)
		if o.Container == "mp4" {
			args = append(args, "-c:s:"+sn, "mov_text")
		} else {
			args = append(args, "-c:s:"+sn, "copy")
		}
		args = append(args, trackMeta("s", sn, s, e, plan, o.Container)...)
		if e.Default != nil || e.Forced != nil {
			def := s.Default
			if e.Default != nil {
				def = *e.Default
			}
			args = append(args, "-disposition:s:"+sn, dispositionValue(def, forcedOf(s, e)))
		}
		if forcedOf(s, e) && o.Container == "mp4" {
			plan.Warnings = append(plan.Warnings, fmt.Sprintf("Untertitel #%d ist „Forced“ – Plex erkennt das nur in MKV-Dateien", s.Index))
		}
		n++
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

// gpuChain builds the video filter chain for VAAPI / NVIDIA when the source is decoded by the GPU.
// "full": frames stay on the GPU (scale_vaapi / scale_cuda) – this only works when the GPU really decodes,
// so a successful run proves hardware decoding. "download": frames are copied back first, then the software filters run.
func gpuChain(mode, kind string, vs *ffmpeg.Stream, w, h int, hwPix string, ten bool, soft []string) []string {
	srcFmt := "nv12"
	if vs.BitDepth > 8 {
		srcFmt = "p010le"
	}
	if mode == "download" {
		chain := append([]string{"hwdownload", "format=" + srcFmt}, soft...)
		chain = append(chain, "format="+hwPix)
		if kind == "vaapi" {
			chain = append(chain, "hwupload")
		}
		return chain
	}
	fmtName := "nv12"
	if ten {
		fmtName = "p010"
		if kind == "cuda" {
			fmtName = "p010le"
		}
	}
	opts := ""
	if w > 0 && h > 0 {
		opts = fmt.Sprintf("w=%d:h=%d:", w, h)
	}
	return []string{"scale_" + kind + "=" + opts + "format=" + fmtName}
}

func forcedOf(s ffmpeg.Stream, e TrackEdit) bool {
	if e.Forced != nil {
		return *e.Forced
	}
	return s.Forced
}

// dispositionValue builds the -disposition argument ("0" clears all flags).
func dispositionValue(def, forced bool) string {
	var f []string
	if def {
		f = append(f, "default")
	}
	if forced {
		f = append(f, "forced")
	}
	if len(f) == 0 {
		return "0"
	}
	return strings.Join(f, "+")
}

// trackMeta returns the -metadata options for title and language of one output track.
func trackMeta(kind, n string, s ffmpeg.Stream, e TrackEdit, plan *Plan, container string) []string {
	var a []string
	if e.Title != nil {
		a = append(a, "-metadata:s:"+kind+":"+n, "title="+strings.TrimSpace(*e.Title))
	}
	if e.Lang != nil {
		if strings.TrimSpace(*e.Lang) == "" {
			a = append(a, "-metadata:s:"+kind+":"+n, "language=und")
		} else if l := iso639(*e.Lang); l != "" {
			a = append(a, "-metadata:s:"+kind+":"+n, "language="+l)
		} else {
			plan.Warnings = append(plan.Warnings, fmt.Sprintf("Spur #%d: Sprache „%s“ ist kein gültiger Code – unverändert gelassen", s.Index, *e.Lang))
		}
	}
	return a
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
