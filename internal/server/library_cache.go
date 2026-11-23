package server

// Merker für den Bibliothek-Scan: was ffprobe über eine Datei gefunden hat, wird mit Größe und Änderungszeit gespeichert (library-cache.json in /config).
// Ein zweiter Scan liest dann nur neue oder geänderte Dateien; die Ergebnisse sind dieselben Fakten wie beim Lesen (kein Schätzen).

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	"github.com/p5lukas/p5converter/internal/ffmpeg"
)

const libCacheVersion = 2 // 2: Ton, Kanäle, Quelle aus dem Dateinamen

// fileFacts: die Fakten einer Datei, aus denen die Ordnerzeilen entstehen.
type fileFacts struct {
	Size   int64    `json:"size"`
	Mtime  int64    `json:"mtime"` // UnixNano
	Dur    float64  `json:"dur"`
	Codec  string   `json:"codec"` // "?" = kein Video
	Height int      `json:"height"`
	Heavy  []string `json:"heavy,omitempty"` // dts, dtshd, truehd
	Img    bool     `json:"img,omitempty"`
	Audio  string   `json:"audio,omitempty"` // Codec der ersten Tonspur (aac, ac3, eac3, dts, dtshd, truehd, flac, opus, mp3 …)
	Src    string   `json:"src,omitempty"`   // Quelle aus dem Dateinamen: remux, bluray, webdl, webrip, web, hdtv, dvd (leer = unbekannt)
}

// factsOf liest die Fakten aus der ffprobe-Antwort (Größe und Zeit setzt der Aufrufer).
func factsOf(info *ffmpeg.Info) fileFacts {
	f := fileFacts{Dur: info.Duration, Codec: "?"}
	if v := info.FirstVideo(); v != nil {
		f.Codec, f.Height = v.Codec, v.Height
	}
	heavy := map[string]bool{}
	for _, st := range info.Streams {
		if st.Type == "audio" && f.Audio == "" {
			f.Audio = audioClass(st.Codec, st.Profile)
		}
		switch {
		case st.Type == "audio" && st.Codec == "truehd":
			heavy["truehd"] = true
		case st.Type == "audio" && st.Codec == "dts":
			if strings.Contains(strings.ToUpper(st.Profile), "MA") || strings.Contains(strings.ToUpper(st.Profile), "HD") {
				heavy["dtshd"] = true
			} else {
				heavy["dts"] = true
			}
		case st.Type == "subtitle" && (st.Codec == "hdmv_pgs_subtitle" || st.Codec == "dvd_subtitle" || st.Codec == "dvb_subtitle" || st.Codec == "xsub"):
			f.Img = true
		}
	}
	for _, k := range []string{"dts", "dtshd", "truehd"} {
		if heavy[k] {
			f.Heavy = append(f.Heavy, k)
		}
	}
	return f
}

// audioClass fasst den Tonformat-Namen von ffprobe für die Oberfläche zusammen (DTS-HD getrennt von DTS).
func audioClass(codec, profile string) string {
	if codec == "dts" {
		if u := strings.ToUpper(profile); strings.Contains(u, "MA") || strings.Contains(u, "HD") {
			return "dtshd"
		}
	}
	return codec
}

// heightClass sortiert die Bildhöhe in die Klassen der Oberfläche: sd (unter 700), 720 (bis 999), 1080 (bis 1999), 2160 (ab 2000).
func heightClass(h int) string {
	switch {
	case h <= 0:
		return ""
	case h < 700:
		return "sd"
	case h < 1000:
		return "720"
	case h < 2000:
		return "1080"
	}
	return "2160"
}

var (
	srcRemux  = regexp.MustCompile(`(?i)(^|[^a-z0-9])remux([^a-z0-9]|$)`)
	srcBluray = regexp.MustCompile(`(?i)(^|[^a-z0-9])(blu-?ray|bdrip|brrip|bdmv|bd)([^a-z0-9]|$)`)
	srcWebDL  = regexp.MustCompile(`(?i)(^|[^a-z0-9])web[-. ]?dl([^a-z0-9]|$)`)
	srcWebRip = regexp.MustCompile(`(?i)(^|[^a-z0-9])web[-. ]?rip([^a-z0-9]|$)`)
	srcWeb    = regexp.MustCompile(`(?i)(^|[^a-z0-9])web([^a-z0-9]|$)`)
	srcHDTV   = regexp.MustCompile(`(?i)(^|[^a-z0-9])(hdtv|pdtv|dsr)([^a-z0-9]|$)`)
	srcDVD    = regexp.MustCompile(`(?i)(^|[^a-z0-9])(dvd(rip)?|dvdr)([^a-z0-9]|$)`)
)

// sourceTag liest die Quelle aus dem Dateinamen, wie sie Plex, Radarr und Sonarr schreiben („… [Bluray-1080p] …“, „… WEBDL-720p …“).
// Reihenfolge: Remux vor Bluray, WEB-DL und WEBRip vor dem allgemeinen WEB. Leer, wenn nichts erkennbar ist.
func sourceTag(name string) string {
	switch {
	case srcRemux.MatchString(name):
		return "remux"
	case srcBluray.MatchString(name):
		return "bluray"
	case srcWebDL.MatchString(name):
		return "webdl"
	case srcWebRip.MatchString(name):
		return "webrip"
	case srcWeb.MatchString(name):
		return "web"
	case srcHDTV.MatchString(name):
		return "hdtv"
	case srcDVD.MatchString(name):
		return "dvd"
	}
	return ""
}

// addFacts rechnet die Fakten einer lesbaren Datei in die Ordnersumme ein.
func (a *libAgg) addFacts(f fileFacts) {
	a.dur += f.Dur
	a.save += int64(float64(f.Size) * (1 - estimateRatio(f.Codec, f.Size, f.Dur, f.Height)))
	a.codecs[f.Codec]++
	if c := heightClass(f.Height); c != "" {
		a.heights[c]++
	}
	if f.Audio != "" {
		a.audio[f.Audio]++
	}
	a.sources[f.Src]++ // "" = unbekannt
	if f.Mtime/1e9 > a.newest {
		a.newest = f.Mtime / 1e9
	}
	if f.Height > a.maxHeight {
		a.maxHeight = f.Height
	}
	for _, k := range f.Heavy {
		a.heavy[k]++
	}
	if f.Img {
		a.imageSubs++
	}
}

type libCache struct {
	mu    sync.Mutex
	path  string // leer = nur im Speicher (Tests, Desktop ohne Config)
	files map[string]fileFacts
	dirty bool
}

func openLibCache(path string) *libCache {
	c := &libCache{path: path, files: map[string]fileFacts{}}
	if path == "" {
		return c
	}
	var disk struct {
		Version int                  `json:"version"`
		Files   map[string]fileFacts `json:"files"`
	}
	if b, err := os.ReadFile(path); err == nil && json.Unmarshal(b, &disk) == nil && disk.Version == libCacheVersion && disk.Files != nil {
		c.files = disk.Files
	}
	return c
}

// get liefert die gemerkten Fakten nur, wenn Größe und Änderungszeit noch stimmen.
func (c *libCache) get(path string, size, mtime int64) (fileFacts, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	f, ok := c.files[path]
	return f, ok && mtime != 0 && f.Size == size && f.Mtime == mtime
}

func (c *libCache) put(path string, f fileFacts) {
	c.mu.Lock()
	c.files[path] = f
	c.dirty = true
	c.mu.Unlock()
}

// finish entfernt Einträge unter root, die es nicht mehr gibt (seen = alle Dateien des Laufs), und schreibt den Merker.
func (c *libCache) finish(root string, seen map[string]bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	prefix := root + string(filepath.Separator)
	for p := range c.files {
		if (p == root || strings.HasPrefix(p, prefix)) && !seen[p] {
			delete(c.files, p)
			c.dirty = true
		}
	}
	if !c.dirty || c.path == "" {
		return
	}
	b, err := json.Marshal(map[string]any{"version": libCacheVersion, "files": c.files})
	if err != nil {
		return
	}
	tmp := c.path + ".tmp"
	if os.WriteFile(tmp, b, 0o644) == nil && os.Rename(tmp, c.path) == nil {
		c.dirty = false
	}
}
