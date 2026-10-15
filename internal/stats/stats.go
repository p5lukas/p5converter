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
	Count int   `json:"count"`
	In    int64 `json:"in"`
	Out   int64 `json:"out"`
}

type Data struct {
	Audio Totals `json:"audio"`
	Video Totals `json:"video"`
	Since string `json:"since"` // date of the first counted job
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
	if s.d.Since == "" {
		s.d.Since = time.Now().Format("2006-01-02")
	}
	if s.file != "" {
		b, _ := json.Marshal(s.d)
		tmp := s.file + ".tmp"
		if os.WriteFile(tmp, b, 0o644) == nil {
			os.Rename(tmp, s.file)
		}
	}
}

func (s *Store) Get() Data {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.d
}
