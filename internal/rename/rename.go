// Package rename builds output file names: name patterns with variables ({title}, {codec}, …) and
// search & replace rules. Used by the converter (output names) and by the stand-alone rename tool.
package rename

import (
	"fmt"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/p5lukas/p5converter/internal/ffmpeg"
)

const (
	MaxRules   = 12
	maxRuleLen = 200
)

// Rule is one search & replace step applied to the file name (without folder and extension).
type Rule struct {
	Find  string `json:"find"`
	With  string `json:"with"`
	Regex bool   `json:"regex"` // Find is a regular expression ($1 … in With)
	Case  bool   `json:"case"`  // case sensitive
}

var invalidChars = strings.NewReplacer("/", "_", "\\", "_", ":", "_", "*", "_", "?", "_", "\"", "_", "<", "_", ">", "_", "|", "_")

// Safe removes characters that are not allowed in file names.
func Safe(s string) string {
	s = strings.TrimSpace(invalidChars.Replace(s))
	return strings.Trim(s, ". ")
}

type compiled struct {
	re   *regexp.Regexp
	with string
	lit  bool
	find string
	fold bool
}

func compile(rules []Rule) ([]compiled, error) {
	if len(rules) > MaxRules {
		return nil, fmt.Errorf("höchstens %d Ersetzungen", MaxRules)
	}
	var out []compiled
	for i, r := range rules {
		if r.Find == "" {
			continue // empty rows are ignored
		}
		if len(r.Find) > maxRuleLen || len(r.With) > maxRuleLen {
			return nil, fmt.Errorf("Ersetzung %d ist zu lang", i+1)
		}
		c := compiled{with: r.With, find: r.Find, fold: !r.Case}
		if r.Regex {
			expr := r.Find
			if !r.Case {
				expr = "(?i)" + expr
			}
			re, err := regexp.Compile(expr)
			if err != nil {
				return nil, fmt.Errorf("Ersetzung %d: ungültiger regulärer Ausdruck (%v)", i+1, err)
			}
			c.re = re
		} else {
			c.lit = true
			if !r.Case {
				c.re = regexp.MustCompile("(?i)" + regexp.QuoteMeta(r.Find))
			}
		}
		out = append(out, c)
	}
	return out, nil
}

// Validate checks the rules without applying them.
func Validate(rules []Rule) error { _, err := compile(rules); return err }

// Apply runs the rules in order on name.
func Apply(name string, rules []Rule) (string, error) {
	cs, err := compile(rules)
	if err != nil {
		return name, err
	}
	for _, c := range cs {
		switch {
		case c.lit && c.re == nil:
			name = strings.ReplaceAll(name, c.find, c.with)
		case c.lit:
			name = c.re.ReplaceAllLiteralString(name, c.with)
		default:
			name = c.re.ReplaceAllString(name, c.with)
		}
	}
	return name, nil
}

var patRe = regexp.MustCompile(`\{(\w+)\}`)

// Target describes what the converter will produce; zero values mean "like the source".
type Target struct {
	Codec     string // h264 | hevc | av1 | vp9 | copy | ""
	Height    int    // 0 = keep (never upscales)
	BitDepth  int    // 0 = like source
	Container string // mkv | mp4 | audio extension
}

var codecLabel = map[string]string{"h264": "x264", "hevc": "x265", "av1": "AV1", "vp9": "VP9", "mpeg4": "MPEG4", "vc1": "VC1"}

func label(c string) string {
	if l, ok := codecLabel[c]; ok {
		return l
	}
	return strings.ToUpper(c)
}

// Vars returns the file based variables ({filename}, {title}, {year}, {codec}, {res}, {bit}, {container}, {date}).
// Tags (artist, album, …) are looked up separately by Pattern.
func Vars(info *ffmpeg.Info, in string, t Target) map[string]string {
	v := map[string]string{
		"filename":  strings.TrimSuffix(filepath.Base(in), filepath.Ext(in)),
		"container": t.Container,
		"date":      time.Now().Format("2006-01-02"),
	}
	if vs := info.FirstVideo(); vs != nil {
		codec := vs.Codec
		if t.Codec != "" && t.Codec != "copy" {
			codec = t.Codec
		}
		v["codec"] = label(codec)
		h := vs.Height
		if t.Height > 0 && t.Height < vs.Height {
			h = t.Height
		}
		if h > 0 {
			v["res"] = strconv.Itoa(h) + "p"
		}
		bit := vs.BitDepth
		if t.BitDepth > 0 && t.Codec != "copy" {
			bit = t.BitDepth
		}
		if bit > 0 {
			v["bit"] = strconv.Itoa(bit) + "bit"
		}
	}
	return v
}

// Variables lists the pattern variables for the UI help.
var Variables = []string{"filename", "title", "year", "res", "codec", "bit", "container", "date",
	"artist", "album", "albumartist", "track", "disc", "genre"}

// Pattern expands {variables} in pat. Folder separators in pat are kept; values are made file-name safe.
func Pattern(pat string, info *ffmpeg.Info, in string, vars map[string]string) string {
	return patRe.ReplaceAllStringFunc(pat, func(m string) string {
		key := m[1 : len(m)-1]
		if v, ok := vars[key]; ok && key != "title" && key != "year" {
			return Safe(v)
		}
		var v string
		switch key {
		case "track", "disc":
			t := info.Tags[key]
			if key == "disc" && t == "" {
				t = info.Tags["discnumber"]
			}
			if key == "track" && t == "" {
				t = info.Tags["tracknumber"]
			}
			t, _, _ = strings.Cut(t, "/")
			if n, err := strconv.Atoi(strings.TrimSpace(t)); err == nil {
				if key == "track" {
					return fmt.Sprintf("%02d", n)
				}
				return strconv.Itoa(n)
			}
			return ""
		case "year":
			v = info.Tags["date"]
			if v == "" {
				v = info.Tags["year"]
			}
			if len(v) > 4 {
				v = v[:4]
			}
		case "albumartist":
			v = info.Tags["album_artist"]
			if v == "" {
				v = info.Tags["albumartist"]
			}
			if v == "" {
				v = info.Tags["artist"]
			}
		case "title":
			v = info.Tags["title"]
			if v == "" {
				return Safe(vars["filename"])
			}
		default:
			v = info.Tags[key]
		}
		v = Safe(v)
		if v == "" {
			v = "Unbekannt"
		}
		return v
	})
}

// NewName is the whole renaming step for one file: pattern (optional), then the rules, then the suffix.
// The result may contain folder separators when the pattern has them (converter only).
func NewName(pat string, rules []Rule, suffix string, info *ffmpeg.Info, in string, t Target) (string, error) {
	base := strings.TrimSuffix(filepath.Base(in), filepath.Ext(in))
	if strings.TrimSpace(pat) != "" {
		base = Pattern(pat, info, in, Vars(info, in, t))
	}
	dir, file := "", base
	if i := strings.LastIndex(filepath.ToSlash(base), "/"); i >= 0 {
		dir, file = filepath.ToSlash(base)[:i+1], filepath.ToSlash(base)[i+1:]
	}
	file, err := Apply(file, rules)
	if err != nil {
		return "", err
	}
	file = strings.TrimLeft(Safe(file), " -")
	if file == "" {
		return "", fmt.Errorf("der neue Name ist leer")
	}
	return dir + file + suffix, nil
}
