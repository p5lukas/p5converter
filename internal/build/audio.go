// Package build turns user options into ffmpeg argument lists.
package build

import (
	"fmt"
	"strconv"

	"github.com/p5lukas/p5converter/internal/ffmpeg"
)

type AudioOpts struct {
	Format     string `json:"format"`     // mp3 ogg opus flac wav m4a
	Mode       string `json:"mode"`       // vbr | cbr
	Quality    int    `json:"quality"`    // mp3: V0-9, ogg: 0-10 (vbr)
	Bitrate    int    `json:"bitrate"`    // kbps (cbr, opus, m4a)
	FlacLevel  int    `json:"flacLevel"`  // 0-8
	WavBits    int    `json:"wavBits"`    // 16, 24, 32
	SampleRate int    `json:"sampleRate"` // 0 = keep
	Channels   int    `json:"channels"`   // 0 = keep
	KeepCover  bool   `json:"keepCover"`
}

func AudioExt(format string) string {
	switch format {
	case "wav", "flac", "mp3", "ogg", "opus", "m4a":
		return format
	}
	return "mp3"
}

func BuildAudio(info *ffmpeg.Info, o AudioOpts, in, out string) ([]string, error) {
	audio := info.ByType("audio")
	if len(audio) == 0 {
		return nil, fmt.Errorf("keine Audiospur gefunden")
	}
	idx := strconv.Itoa(audio[0].Index)
	a := []string{"-hide_banner", "-nostdin", "-y", "-progress", "pipe:1", "-nostats", "-i", in, "-map", "0:" + idx}

	cover := info.Cover()
	coverOK := o.KeepCover && cover != nil && (cover.Codec == "mjpeg" || cover.Codec == "png") &&
		(o.Format == "mp3" || o.Format == "flac" || o.Format == "m4a")
	if coverOK {
		a = append(a, "-map", "0:"+strconv.Itoa(cover.Index))
	}
	if info.TagsInStream {
		a = append(a, "-map_metadata", "0:s:"+idx)
	} else {
		a = append(a, "-map_metadata", "0")
	}

	switch o.Format {
	case "mp3":
		a = append(a, "-c:a", "libmp3lame")
		if o.Mode == "cbr" {
			a = append(a, "-b:a", kbps(o.Bitrate, 192))
		} else {
			a = append(a, "-q:a", strconv.Itoa(clamp(o.Quality, 0, 9)))
		}
		a = append(a, "-id3v2_version", "3", "-write_id3v1", "1")
	case "ogg":
		a = append(a, "-c:a", "libvorbis")
		if o.Mode == "cbr" {
			a = append(a, "-b:a", kbps(o.Bitrate, 192))
		} else {
			a = append(a, "-q:a", strconv.Itoa(clamp(o.Quality, -1, 10)))
		}
	case "opus":
		a = append(a, "-c:a", "libopus", "-b:a", kbps(o.Bitrate, 128))
		if o.Mode == "cbr" {
			a = append(a, "-vbr", "off")
		}
	case "m4a":
		a = append(a, "-c:a", "aac", "-b:a", kbps(o.Bitrate, 192))
	case "flac":
		a = append(a, "-c:a", "flac", "-compression_level", strconv.Itoa(clamp(o.FlacLevel, 0, 8)))
	case "wav":
		codec := map[int]string{16: "pcm_s16le", 24: "pcm_s24le", 32: "pcm_s32le"}[o.WavBits]
		if codec == "" {
			codec = "pcm_s16le"
		}
		a = append(a, "-c:a", codec)
	default:
		return nil, fmt.Errorf("unbekanntes Audioformat %q", o.Format)
	}
	if coverOK {
		a = append(a, "-c:v", "copy", "-disposition:v", "attached_pic")
	}
	if o.SampleRate > 0 {
		a = append(a, "-ar", strconv.Itoa(o.SampleRate))
	}
	if o.Channels > 0 {
		a = append(a, "-ac", strconv.Itoa(o.Channels))
	}
	muxer := map[string]string{"mp3": "mp3", "ogg": "ogg", "opus": "opus", "flac": "flac", "wav": "wav", "m4a": "ipod"}[o.Format]
	a = append(a, "-f", muxer, out)
	return a, nil
}

func kbps(v, def int) string {
	if v <= 0 {
		v = def
	}
	return strconv.Itoa(v) + "k"
}

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
