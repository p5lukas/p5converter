// Package stats keeps the lifetime totals shown on the start page ("bisher gewonnener Platz").
package stats

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Totals per world: how many files were converted and how many bytes went in and came out.
type Totals struct {
	Count int    `json:"count"`
	In    int64  `json:"in"`
	Out   int64  `json:"out"`
	Since string `json:"since,omitempty"` // date of the first counted job of this world (since the last reset)
}

// Data keeps the two worlds strictly apart. Since is only read from files of version 0.0.9 and older
// (one common date); it is handed to both worlds on opening and no longer written.
type Data struct {
	Audio Totals `json:"audio"`
	Video Totals `json:"video"`
	Since string `json:"since,omitempty"`
}

// Store persists the totals in dir/stats.json (dir == "": memory only).
type Store struct {
	mu   sync.Mutex
	file string
	d    Data
}

func Open(dir string) *Store {
	s := &Store{}
	if dir == "" {
		return s
	}
	s.file = filepath.Join(dir, "stats.json")
	if b, err := os.ReadFile(s.file); err == nil {
		json.Unmarshal(b, &s.d)
	}
	if s.d.Since != "" {
		if s.d.Audio.Count > 0 && s.d.Audio.Since == "" {
			s.d.Audio.Since = s.d.Since
		}
		if s.d.Video.Count > 0 && s.d.Video.Since == "" {
			s.d.Video.Since = s.d.Since
		}
		s.d.Since = ""
	}
	return s
}

// Add counts one finished conversion (kind: audio | video).
func (s *Store) Add(kind string, in, out int64) {
	if in <= 0 || out <= 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	t := &s.d.Video
	if kind == "audio" {
		t = &s.d.Audio
	}
	t.Count++
	t.In += in
	t.Out += out
	if t.Since == "" {
		t.Since = time.Now().Format("2006-01-02")
	}
	s.save()
}

// Reset clears the totals of ONE world (audio | video); the other world is not touched.
func (s *Store) Reset(kind string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if kind == "audio" {
		s.d.Audio = Totals{}
	} else {
		s.d.Video = Totals{}
	}
	s.save()
}

func (s *Store) save() {
	if s.file == "" {
		return
	}
	b, _ := json.Marshal(s.d)
	tmp := s.file + ".tmp"
	if os.WriteFile(tmp, b, 0o644) == nil {
		os.Rename(tmp, s.file)
	}
}

func (s *Store) Get() Data {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.d
}
