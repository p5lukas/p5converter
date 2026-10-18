// Package ffmpeg locates ffmpeg/ffprobe and wraps probing.
package ffmpeg

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/p5lukas/p5converter/internal/proc"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

type Tools struct {
	FFmpeg  string
	FFprobe string
}

func exe(name string) string {
	if runtime.GOOS == "windows" {
		return name + ".exe"
	}
	return name
}

// Locate searches (in order): the override dir, the directory of the running
// binary, then PATH.
func Locate(overrideDir string) (Tools, error) {
	var dirs []string
	if overrideDir != "" {
		dirs = append(dirs, overrideDir)
	}
	if self, err := os.Executable(); err == nil {
		d := filepath.Dir(self)
		dirs = append(dirs, d, filepath.Join(d, "ffmpeg"), filepath.Join(d, "bin"))
	}
	find := func(name string) string {
		for _, d := range dirs {
			p := filepath.Join(d, exe(name))
			if st, err := os.Stat(p); err == nil && !st.IsDir() {
				return p
			}
		}
		if p, err := exec.LookPath(name); err == nil {
			return p
		}
		return ""
	}
	t := Tools{FFmpeg: find("ffmpeg"), FFprobe: find("ffprobe")}
	if t.FFmpeg == "" || t.FFprobe == "" {
		return t, errors.New("ffmpeg/ffprobe nicht gefunden (PATH, Programmordner oder P5_FFMPEG_DIR)")
	}
	return t, nil
}

func (t Tools) Version() string {
	out, err := proc.Command(t.FFmpeg, "-version").Output()
	if err != nil {
		return ""
	}
	line, _, _ := strings.Cut(string(out), "\n")
	return strings.TrimSpace(line)
}

// Encoders returns the set of encoder names compiled into ffmpeg.
func (t Tools) Encoders() map[string]bool {
	set := map[string]bool{}
	out, err := proc.Command(t.FFmpeg, "-hide_banner", "-encoders").Output()
	if err != nil {
		return set
	}
	sc := bufio.NewScanner(bytes.NewReader(out))
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) >= 2 && len(f[0]) == 6 && (f[0][0] == 'V' || f[0][0] == 'A' || f[0][0] == 'S') {
			set[f[1]] = true
		}
	}
	return set
}

type Stream struct {
	Index       int    `json:"index"`
	Type        string `json:"type"` // video, audio, subtitle, attachment, data
	Codec       string `json:"codec"`
	Profile     string `json:"profile,omitempty"`
	Lang        string `json:"lang,omitempty"`
	Title       string `json:"title,omitempty"`
	Channels    int    `json:"channels,omitempty"`
	Layout      string `json:"layout,omitempty"`
	Width       int    `json:"width,omitempty"`
	Height      int    `json:"height,omitempty"`
	PixFmt      string `json:"pixFmt,omitempty"`
	BitDepth    int    `json:"bitDepth,omitempty"`
	BitRate     int64  `json:"bitRate,omitempty"`
	SampleRate  int    `json:"sampleRate,omitempty"`
	Default     bool   `json:"default,omitempty"`
	Forced      bool   `json:"forced,omitempty"`
	AttachedPic bool   `json:"attachedPic,omitempty"`
	// Frames/Bytes: size of the track from the MKV statistics tags (NUMBER_OF_FRAMES/NUMBER_OF_BYTES; 0 = unknown).
	// For subtitles frames = number of lines; used to guess forced subtitles by their size.
	Frames int64 `json:"frames,omitempty"`
	Bytes  int64 `json:"bytes,omitempty"`
}

type Info struct {
	Path     string            `json:"path"`
	Format   string            `json:"format"`
	Duration float64           `json:"duration"`
	Size     int64             `json:"size"`
	BitRate  int64             `json:"bitRate"`
	Tags     map[string]string `json:"tags"`
	// TagsInStream is true when the tags only exist on the audio stream
	// (typical for Ogg/Opus) and must be mapped explicitly.
	TagsInStream bool     `json:"-"`
	Streams      []Stream `json:"streams"`
}

type rawProbe struct {
	Streams []struct {
		Index         int               `json:"index"`
		CodecType     string            `json:"codec_type"`
		CodecName     string            `json:"codec_name"`
		Profile       string            `json:"profile"`
		Width         int               `json:"width"`
		Height        int               `json:"height"`
		PixFmt        string            `json:"pix_fmt"`
		Channels      int               `json:"channels"`
		ChannelLayout string            `json:"channel_layout"`
		SampleRate    string            `json:"sample_rate"`
		BitRate       string            `json:"bit_rate"`
		BitsPerRaw    string            `json:"bits_per_raw_sample"`
		Tags          map[string]string `json:"tags"`
		Disposition   map[string]int    `json:"disposition"`
	} `json:"streams"`
	Format struct {
		FormatName string            `json:"format_name"`
		Duration   string            `json:"duration"`
		Size       string            `json:"size"`
		BitRate    string            `json:"bit_rate"`
		Tags       map[string]string `json:"tags"`
	} `json:"format"`
}

func lowerKeys(m map[string]string) map[string]string {
	o := make(map[string]string, len(m))
	for k, v := range m {
		o[strings.ToLower(k)] = v
	}
	return o
}

func (t Tools) Probe(ctx context.Context, path string) (*Info, error) {
	cmd := proc.CommandContext(ctx, t.FFprobe, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("ffprobe: %v: %s", err, strings.TrimSpace(stderr.String()))
	}
	var r rawProbe
	if err := json.Unmarshal(out, &r); err != nil {
		return nil, err
	}
	atoi := func(s string) int64 { n, _ := strconv.ParseInt(s, 10, 64); return n }
	info := &Info{Path: path, Format: r.Format.FormatName, Tags: lowerKeys(r.Format.Tags),
		Size: atoi(r.Format.Size), BitRate: atoi(r.Format.BitRate)}
	info.Duration, _ = strconv.ParseFloat(r.Format.Duration, 64)
	for _, s := range r.Streams {
		tags := lowerKeys(s.Tags)
		st := Stream{Index: s.Index, Type: s.CodecType, Codec: s.CodecName, Profile: s.Profile,
			Lang: tags["language"], Title: tags["title"], Channels: s.Channels, Layout: s.ChannelLayout,
			Width: s.Width, Height: s.Height, PixFmt: s.PixFmt, BitRate: atoi(s.BitRate),
			SampleRate: int(atoi(s.SampleRate)), Default: s.Disposition["default"] == 1, Forced: s.Disposition["forced"] == 1,
			AttachedPic: s.Disposition["attached_pic"] == 1}
		if st.Type == "subtitle" {
			st.Frames, st.Bytes = statTag(tags, "number_of_frames"), statTag(tags, "number_of_bytes")
		}
		if st.Type == "video" {
			st.BitDepth = bitDepth(s.PixFmt, int(atoi(s.BitsPerRaw)))
		}
		// merge stream tags into file tags for audio-only files (mp3/ogg keep tags on the stream)
		if st.Type == "audio" {
			for k, v := range tags {
				if _, ok := info.Tags[k]; !ok {
					info.Tags[k] = v
				}
			}
		}
		info.Streams = append(info.Streams, st)
	}
	info.TagsInStream = len(r.Format.Tags) == 0 && len(info.Tags) > 0
	return info, nil
}

// statTag reads an MKV statistics tag; mkvmerge writes it with the language appended (NUMBER_OF_FRAMES-eng).
func statTag(tags map[string]string, name string) int64 {
	if v, ok := tags[name]; ok {
		n, _ := strconv.ParseInt(strings.TrimSpace(v), 10, 64)
		return n
	}
	for k, v := range tags {
		if strings.HasPrefix(k, name+"-") {
			n, _ := strconv.ParseInt(strings.TrimSpace(v), 10, 64)
			return n
		}
	}
	return 0
}

func bitDepth(pixFmt string, raw int) int {
	if raw > 0 {
		return raw
	}
	for _, d := range []int{16, 14, 12, 10, 9} {
		if strings.Contains(pixFmt, strconv.Itoa(d)+"le") || strings.Contains(pixFmt, strconv.Itoa(d)+"be") {
			return d
		}
	}
	if strings.HasPrefix(pixFmt, "p010") {
		return 10
	}
	return 8
}

// FirstVideo returns the first non-cover video stream.
func (i *Info) FirstVideo() *Stream {
	for k := range i.Streams {
		if i.Streams[k].Type == "video" && !i.Streams[k].AttachedPic {
			return &i.Streams[k]
		}
	}
	return nil
}

func (i *Info) Cover() *Stream {
	for k := range i.Streams {
		if i.Streams[k].Type == "video" && i.Streams[k].AttachedPic {
			return &i.Streams[k]
		}
	}
	return nil
}

func (i *Info) ByType(t string) []Stream {
	var o []Stream
	for _, s := range i.Streams {
		if s.Type == t && !s.AttachedPic {
			o = append(o, s)
		}
	}
	return o
}
