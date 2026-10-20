// Package config stores the user settings (presets, track rules, language wishes, defaults) as JSON in the config
// folder (Docker: /config). Without a writable folder everything stays in memory and the UI says so.
package config

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

type Preset struct {
	ID      string         `json:"id"`
	Name    string         `json:"name"`
	World   string         `json:"world"` // kind: audio | video
	Suggest bool           `json:"suggest"`
	Values  map[string]any `json:"values"`
}

// Verify: the default of the controls after a conversion (one set per world; the wizard can change it per run).
type Verify struct {
	Tracks bool `json:"tracks"` // A: tracks complete, size plausible
	Decode bool `json:"decode"` // B: read the whole result once
}

func defaultVerify() Verify { return Verify{Tracks: true, Decode: true} }

// SubPref is one wish for the default subtitle: a language, optionally only the "forced" subtitle of it.
type SubPref struct {
	Lang   string `json:"lang"`
	Forced bool   `json:"forced"`
}

// TrackPrefs are the language wishes for "Audio & Untertitel" (video world): which languages to keep (empty = all) and which audio /
// subtitle becomes the default, as a ranking (first match wins).
type TrackPrefs struct {
	AudioKeep    []string  `json:"audioKeep"`
	SubKeep      []string  `json:"subKeep"`
	AudioDefault []string  `json:"audioDefault"`
	SubDefault   []SubPref `json:"subDefault"`
}

// AudioRule is one general rule for audio tracks ("DTS → E-AC-3, 256 kbit/s per stereo pair"); the first matching rule wins.
type AudioRule struct {
	Codec  string `json:"codec"`  // any | dts | dtshd | truehd | eac3 | ac3 | aac | flac | pcm | mp3 | opus | vorbis
	Ch     string `json:"ch"`     // any | multi | stereo
	Action string `json:"action"` // copy | encode | drop
	To     string `json:"to,omitempty"`
	Kbps   int    `json:"kbps,omitempty"` // per stereo pair
}

// SubRule is one general rule for subtitles ("remove image subtitles").
type SubRule struct {
	Kind   string `json:"kind"`   // any | image | text
	Action string `json:"action"` // copy | drop
}

// TrackRules are the general rules (video kind); they are offered in the converter as "preset rules" that can be switched off per run.
type TrackRules struct {
	Audio []AudioRule `json:"audio"`
	Sub   []SubRule   `json:"sub"`
}

type Settings struct {
	Concurrency      int               `json:"concurrency"`      // parallel video jobs
	ConcurrencyAudio int               `json:"concurrencyAudio"` // parallel audio jobs
	DefaultOutDir    string            `json:"defaultOutDir"`
	ShowNews         bool              `json:"showNews"`
	PreferredBackend string            `json:"preferredBackend"` // auto | cpu | qsv | nvenc | vaapi | amf
	HWDecode         bool              `json:"hwDecode"`
	Presets          []Preset          `json:"presets"`
	Verify           map[string]Verify `json:"verify"`
	TrackPrefs       TrackPrefs        `json:"trackPrefs"`
	TrackRules       TrackRules        `json:"trackRules"`
	NoRain           bool              `json:"noRain"` // true = no Matrix rain when a job is finished (false = on, the default)
	// RootNames: display names for the source folders (key = path in the container, e.g. "/video1"); the browser shows the name, the path stays the real one.
	RootNames map[string]string `json:"rootNames"`
}

// Fields a preset may contain, per world (the ids of the UI controls).
var presetFields = map[string][]string{
	"audio": {"aFormat", "aMode", "aQuality", "aBitrate", "aFlac", "aWav", "aRate", "aCh", "aCover", "pattern", "suffix", "renRules"},
	"video": {"vContainer", "vCodec", "vBackend", "vCrf", "vQuality", "vPreset", "vDepth", "vHeight", "vHwDec",
		"vAudioMode", "vAudioCodec", "vAudioKbps", "vAudioLangs", "vSubMode", "vSubLangs", "vTrkRules", "pattern", "suffix", "renRules"},
}

func Defaults() Settings {
	p := func(id, name, world string, v map[string]any) Preset {
		return Preset{ID: id, Name: name, World: world, Suggest: true, Values: v}
	}
	return Settings{
		ShowNews:         true,
		TrackRules:       TrackRules{Audio: []AudioRule{}, Sub: []SubRule{}},
		TrackPrefs:       TrackPrefs{AudioKeep: []string{}, SubKeep: []string{}, AudioDefault: []string{}, SubDefault: []SubPref{}},
		PreferredBackend: "auto",
		HWDecode:         true,
		Verify:           map[string]Verify{"audio": defaultVerify(), "video": defaultVerify()},
		Presets: []Preset{
			p("v-remux", "Remux als MKV", "video", map[string]any{"vCodec": "copy", "vContainer": "mkv"}),
			p("a-flac", "Remux als FLAC", "audio", map[string]any{"aFormat": "flac", "aFlac": 5}),
		},
	}
}

type Store struct {
	dir        string
	mu         sync.Mutex
	s          Settings
	persistent bool
	existed    bool
}

// Open loads (or creates) the settings in dir. dir == "" or not writable -> memory only.
func Open(dir string) *Store {
	st := &Store{dir: dir, s: Defaults()}
	if dir != "" {
		if err := os.MkdirAll(dir, 0o755); err == nil {
			probe := filepath.Join(dir, ".write-test")
			if err := os.WriteFile(probe, []byte("x"), 0o644); err == nil {
				os.Remove(probe)
				st.persistent = true
			}
		}
	}
	if st.persistent {
		if b, err := os.ReadFile(filepath.Join(dir, "settings.json")); err == nil {
			var loaded Settings
			if json.Unmarshal(b, &loaded) == nil {
				if clean, err := Validate(loaded); err == nil {
					st.s, st.existed = clean, true
				}
			}
		}
	}
	return st
}

func (st *Store) Get() Settings {
	st.mu.Lock()
	defer st.mu.Unlock()
	b, _ := json.Marshal(st.s) // deep copy
	var c Settings
	json.Unmarshal(b, &c)
	return c
}

func (st *Store) Persistent() bool { return st.persistent }
func (st *Store) Dir() string      { return st.dir }
func (st *Store) Existed() bool    { return st.existed }

// Put validates and saves. Returns the cleaned settings.
func (st *Store) Put(in Settings) (Settings, error) {
	clean, err := Validate(in)
	if err != nil {
		return Settings{}, err
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	if st.persistent {
		b, _ := json.MarshalIndent(clean, "", "  ")
		tmp := filepath.Join(st.dir, "settings.json.tmp")
		if err := os.WriteFile(tmp, b, 0o644); err != nil {
			return Settings{}, err
		}
		if err := os.Rename(tmp, filepath.Join(st.dir, "settings.json")); err != nil {
			return Settings{}, err
		}
	}
	st.s = clean
	return clean, nil
}

func contains(l []string, v string) bool {
	for _, x := range l {
		if x == v {
			return true
		}
	}
	return false
}

func newID() string {
	b := make([]byte, 4)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// Validate normalises user input and rejects anything out of range.
func Validate(in Settings) (Settings, error) {
	out := in
	if out.ConcurrencyAudio < 0 || out.ConcurrencyAudio > 8 {
		return Settings{}, errors.New("Parallele Audio-Aufträge: 1–8")
	}
	if out.Concurrency < 0 || out.Concurrency > 8 {
		return Settings{}, errors.New("Parallele Aufträge: 1–8")
	}
	if len(out.DefaultOutDir) > 500 {
		return Settings{}, errors.New("Zielordner zu lang")
	}
	if !contains([]string{"auto", "cpu", "qsv", "nvenc", "vaapi", "amf"}, out.PreferredBackend) {
		out.PreferredBackend = "auto"
	}
	// settings files from before 0.1.4 have no "verify": the defaults apply (A and B on); old fields (graceDays …) are ignored
	ver := map[string]Verify{}
	for _, w := range []string{"audio", "video"} {
		v, ok := out.Verify[w]
		if !ok {
			v = defaultVerify()
		}
		ver[w] = v
	}
	out.Verify = ver
	tp, err := cleanTrackPrefs(out.TrackPrefs)
	if err != nil {
		return Settings{}, err
	}
	out.TrackPrefs = tp
	tr, err := cleanTrackRules(out.TrackRules)
	if err != nil {
		return Settings{}, err
	}
	out.TrackRules = tr
	names, err := cleanRootNames(out.RootNames)
	if err != nil {
		return Settings{}, err
	}
	out.RootNames = names
	if len(out.Presets) > 100 {
		return Settings{}, errors.New("Höchstens 100 Voreinstellungen")
	}
	seen := map[string]bool{}
	presets := make([]Preset, 0, len(out.Presets))
	for _, p := range out.Presets {
		p.Name = strings.TrimSpace(p.Name)
		if p.Name == "" || len([]rune(p.Name)) > 40 {
			return Settings{}, errors.New("Name der Voreinstellung: 1–40 Zeichen")
		}
		allowed, ok := presetFields[p.World]
		if !ok {
			return Settings{}, fmt.Errorf("Voreinstellung %q: Art muss audio oder video sein", p.Name)
		}
		if p.ID == "" || seen[p.ID] || len(p.ID) > 40 {
			p.ID = newID()
		}
		seen[p.ID] = true
		vals := map[string]any{}
		for k, v := range p.Values {
			if !contains(allowed, k) {
				continue // silently drop unknown fields
			}
			switch t := v.(type) {
			case string:
				if len(t) > 3000 {
					return Settings{}, fmt.Errorf("Wert %s zu lang", k)
				}
			case float64, bool:
			default:
				return Settings{}, fmt.Errorf("Wert %s hat einen ungültigen Typ", k)
			}
			vals[k] = v
		}
		p.Values = vals
		presets = append(presets, p)
	}
	out.Presets = presets
	return out, nil
}

// cleanLangs lower-cases, dedupes and checks language codes (2-3 letters); the result is never nil.
func cleanLangs(in []string) ([]string, error) {
	if len(in) > 30 {
		return nil, errors.New("Sprachliste: höchstens 30 Einträge")
	}
	out := []string{}
	seen := map[string]bool{}
	for _, l := range in {
		l = strings.ToLower(strings.TrimSpace(l))
		if len(l) < 2 || len(l) > 3 || strings.Trim(l, "abcdefghijklmnopqrstuvwxyz") != "" {
			return nil, fmt.Errorf("Sprachcode %q ist ungültig (2–3 Buchstaben)", l)
		}
		if !seen[l] {
			seen[l] = true
			out = append(out, l)
		}
	}
	return out, nil
}

func cleanTrackPrefs(in TrackPrefs) (TrackPrefs, error) {
	var out TrackPrefs
	var err error
	if out.AudioKeep, err = cleanLangs(in.AudioKeep); err != nil {
		return out, err
	}
	if out.SubKeep, err = cleanLangs(in.SubKeep); err != nil {
		return out, err
	}
	if out.AudioDefault, err = cleanLangs(in.AudioDefault); err != nil {
		return out, err
	}
	out.SubDefault = []SubPref{}
	seen := map[SubPref]bool{}
	if len(in.SubDefault) > 30 {
		return out, errors.New("Standard-Untertitel: höchstens 30 Einträge")
	}
	for _, p := range in.SubDefault {
		l, err := cleanLangs([]string{p.Lang})
		if err != nil {
			return out, err
		}
		q := SubPref{Lang: l[0], Forced: p.Forced}
		if !seen[q] {
			seen[q] = true
			out.SubDefault = append(out.SubDefault, q)
		}
	}
	return out, nil
}

var (
	ruleCodecs  = []string{"any", "dts", "dtshd", "truehd", "eac3", "ac3", "aac", "flac", "pcm", "mp3", "opus", "vorbis"}
	ruleTargets = []string{"aac", "opus", "ac3", "eac3", "flac", "mp3"}
)

// cleanTrackRules checks the general track rules: known values only, at most 30 per list, bitrates 32–640; the lists are never nil.
func cleanTrackRules(in TrackRules) (TrackRules, error) {
	out := TrackRules{Audio: []AudioRule{}, Sub: []SubRule{}}
	if len(in.Audio) > 30 || len(in.Sub) > 30 {
		return out, errors.New("Regeln: höchstens 30 je Liste")
	}
	for _, r := range in.Audio {
		if r.Codec == "" {
			r.Codec = "any"
		}
		if r.Ch == "" {
			r.Ch = "any"
		}
		if !contains(ruleCodecs, r.Codec) || !contains([]string{"any", "multi", "stereo"}, r.Ch) || !contains([]string{"copy", "encode", "drop"}, r.Action) {
			return out, errors.New("Regel für Ton: ungültiger Wert")
		}
		if r.Action == "encode" {
			if !contains(ruleTargets, r.To) {
				return out, errors.New("Regel für Ton: Zielformat ungültig")
			}
			if r.Kbps < 0 || r.Kbps > 640 || (r.Kbps > 0 && r.Kbps < 32) {
				return out, errors.New("Regel für Ton: Bitrate 32–640 kbit/s")
			}
		} else {
			r.To, r.Kbps = "", 0
		}
		out.Audio = append(out.Audio, r)
	}
	for _, r := range in.Sub {
		if r.Kind == "" {
			r.Kind = "any"
		}
		if !contains([]string{"any", "image", "text"}, r.Kind) || !contains([]string{"copy", "drop"}, r.Action) {
			return out, errors.New("Regel für Untertitel: ungültiger Wert")
		}
		out.Sub = append(out.Sub, r)
	}
	return out, nil
}

// cleanRootNames keeps only non-empty names (trimmed, at most 40 characters) for paths of at most 500 characters; at most 50 entries.
func cleanRootNames(in map[string]string) (map[string]string, error) {
	if len(in) > 50 {
		return nil, errors.New("Höchstens 50 Anzeigenamen für Ordner")
	}
	out := map[string]string{}
	for k, v := range in {
		k, v = strings.TrimSpace(k), strings.TrimSpace(v)
		if k == "" || v == "" {
			continue
		}
		if len(k) > 500 {
			return nil, errors.New("Ordnerpfad zu lang")
		}
		if len([]rune(v)) > 40 {
			return nil, errors.New("Anzeigename eines Ordners: höchstens 40 Zeichen")
		}
		out[k] = v
	}
	return out, nil
}
