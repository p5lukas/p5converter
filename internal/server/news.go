package server

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
)

// Neuigkeiten wie bei p5assets: je Version einmal ein kurzer Hinweis (die Überschriften); die vollständige Liste liegt in der Fußzeile.
// Was schon gezeigt wurde, steht auf dem Server (news-seen.json im Konfigurationsordner), gilt also für alle Geräte.

type newsEntry struct {
	ID      string `json:"id"`
	Version string `json:"version"`
	Title   string `json:"title"`
	Text    string `json:"text"`
}

type newsState struct {
	VersionSeen string   `json:"versionSeen"` // letzte Version, deren Hinweis gezeigt wurde
	Seen        []string `json:"seen"`        // einzelne Einträge, die in der Liste als gelesen gelten
}

// legacyNewsVersion: Installationen von vor dieser Funktion (0.0.9 und älter) haben noch keinen Merker; für sie gelten
// alle Neuigkeiten bis zu dieser Version als bekannt, damit sie den Hinweis zur nächsten Version einmal sehen.
const legacyNewsVersion = "0.0.9"

type newsStore struct {
	mu    sync.Mutex
	file  string // leer = nur Speicher
	state newsState
}

func openNews(dir string, persistent bool, entries []newsEntry, current string) *newsStore {
	n := &newsStore{}
	if !persistent || dir == "" {
		n.state = newsState{VersionSeen: current, Seen: ids(entries)} // ohne Speicherort kein Dauerhinweis
		return n
	}
	n.file = filepath.Join(dir, "news-seen.json")
	if b, err := os.ReadFile(n.file); err == nil && json.Unmarshal(b, &n.state) == nil {
		return n
	}
	// kein Merker: frische Installation (nichts anderes im Ordner) → alles gilt als gesehen; sonst Update einer älteren Version
	fresh := true
	for _, f := range []string{"settings.json", "stats.json"} {
		if _, err := os.Stat(filepath.Join(dir, f)); err == nil {
			fresh = false
		}
	}
	if fresh {
		n.state = newsState{VersionSeen: current, Seen: ids(entries)}
	} else {
		n.state = newsState{VersionSeen: legacyNewsVersion}
		for _, e := range entries {
			if vKey(e.Version) <= vKey(legacyNewsVersion) {
				n.state.Seen = append(n.state.Seen, e.ID)
			}
		}
	}
	n.save()
	return n
}

func ids(es []newsEntry) []string {
	o := make([]string, 0, len(es))
	for _, e := range es {
		o = append(o, e.ID)
	}
	return o
}

func (n *newsStore) save() {
	if n.file == "" {
		return
	}
	b, _ := json.Marshal(n.state)
	tmp := n.file + ".tmp"
	if os.WriteFile(tmp, b, 0o644) == nil {
		os.Rename(tmp, n.file)
	}
}

// vKey macht aus "0.0.10" eine vergleichbare Zahl (0.0.10 > 0.0.9).
func vKey(v string) int {
	k := 0
	parts := strings.Split(strings.TrimPrefix(v, "v"), ".")
	for i := 0; i < 3; i++ {
		x := 0
		if i < len(parts) {
			x, _ = strconv.Atoi(parts[i])
		}
		k = k*1000 + x
	}
	return k
}

type newsReply struct {
	Version    string      `json:"version"`
	Show       bool        `json:"show"`
	Count      int         `json:"count"`
	Highlights []string    `json:"highlights"`
	All        []newsEntry `json:"all"`
	Seen       []string    `json:"seen"`
}

func (s *Server) newsReply() newsReply {
	cur := s.Build.Base
	s.news.mu.Lock()
	defer s.news.mu.Unlock()
	r := newsReply{Version: cur, All: s.newsEntries, Seen: s.news.state.Seen, Highlights: []string{}}
	if r.All == nil {
		r.All = []newsEntry{}
	}
	if r.Seen == nil {
		r.Seen = []string{}
	}
	for _, e := range s.newsEntries {
		if vKey(e.Version) > vKey(s.news.state.VersionSeen) && vKey(e.Version) <= vKey(cur) {
			r.Count++
			if len(r.Highlights) < 4 {
				r.Highlights = append(r.Highlights, e.Title)
			}
		}
	}
	r.Show = r.Count > 0 && s.Settings.Get().ShowNews
	return r
}

func (s *Server) newsGet(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, s.newsReply())
}

func (s *Server) newsSeen(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IDs     []string `json:"ids"`
		Version bool     `json:"version"` // der Hinweis der aktuellen Version wurde gezeigt
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&body) != nil {
		http.Error(w, `{"error":"ungültige Anfrage"}`, 400)
		return
	}
	known := map[string]bool{}
	for _, e := range s.newsEntries {
		known[e.ID] = true
	}
	s.news.mu.Lock()
	have := map[string]bool{}
	for _, id := range s.news.state.Seen {
		have[id] = true
	}
	for _, id := range body.IDs {
		if known[id] && !have[id] {
			s.news.state.Seen = append(s.news.state.Seen, id)
		}
	}
	if body.Version {
		s.news.state.VersionSeen = s.Build.Base
	}
	s.news.save()
	s.news.mu.Unlock()
	writeJSON(w, map[string]bool{"ok": true})
}
