// Package stats keeps the lifetime totals shown on the start page ("bisher gewonnener Platz").
package stats

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
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

// Month sums up one calendar month of one world ("2006-01" is the key in Data.Months).
type Month struct {
	Count   int   `json:"count"`
	In      int64 `json:"in"`
	Out     int64 `json:"out"`
	Seconds int   `json:"seconds"` // running time of the conversions
}

// Past is one finished conversion taken from the history (used once to fill the months).
type Past struct {
	Kind    string
	Ended   time.Time
	In, Out int64
	Seconds int
}

// Data keeps the two worlds strictly apart. Since is only read from files of version 0.0.9 and older
// (one common date); it is handed to both worlds on opening and no longer written.
type Data struct {
	Audio Totals `json:"audio"`
	Video Totals `json:"video"`
	Since string `json:"since,omitempty"`
	// Months: per world and calendar month ("2006-01") the number of files, bytes in/out and running time (for the chart over time).
	Months map[string]map[string]Month `json:"months,omitempty"`
	// Backfilled: the months were filled once from the history (at most the last entries per world), so the first months can be incomplete.
	Backfilled bool `json:"backfilled,omitempty"`
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

// Add counts one finished conversion (kind: audio | video) in the totals and in the current month.
func (s *Store) Add(kind string, in, out int64, seconds int) {
	if in <= 0 || out <= 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	t := &s.d.Video
	if kind == "audio" {
		t = &s.d.Audio
	} else {
		kind = "video"
	}
	t.Count++
	t.In += in
	t.Out += out
	now := time.Now()
	if t.Since == "" {
		t.Since = now.Format("2006-01-02")
	}
	s.addMonth(kind, now, in, out, seconds)
	s.save()
}

func (s *Store) addMonth(kind string, at time.Time, in, out int64, seconds int) {
	if s.d.Months == nil {
		s.d.Months = map[string]map[string]Month{}
	}
	if s.d.Months[kind] == nil {
		s.d.Months[kind] = map[string]Month{}
	}
	key := at.Format("2006-01")
	m := s.d.Months[kind][key]
	m.Count++
	m.In += in
	m.Out += out
	if seconds > 0 {
		m.Seconds += seconds
	}
	s.d.Months[kind][key] = m
}

// Backfill fills the months ONCE from finished conversions of the history (only the successful ones with sizes). Returns false if it was done before.
// It does not touch the totals; they were counted all along.
func (s *Store) Backfill(list []Past) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.d.Backfilled {
		return false
	}
	s.d.Backfilled = true
	for _, p := range list {
		if p.In <= 0 || p.Out <= 0 || p.Ended.IsZero() || (p.Kind != "audio" && p.Kind != "video") {
			continue
		}
		s.addMonth(p.Kind, p.Ended, p.In, p.Out, p.Seconds)
	}
	s.save()
	return true
}

// MonthRow is one month of the chart data.
type MonthRow struct {
	Month   string `json:"month"` // "2006-01"
	Count   int    `json:"count"`
	In      int64  `json:"in"`
	Out     int64  `json:"out"`
	Seconds int    `json:"seconds"`
}

// History lists the months of one world, oldest first.
func (s *Store) History(kind string) []MonthRow {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []MonthRow
	for k, m := range s.d.Months[kind] {
		out = append(out, MonthRow{Month: k, Count: m.Count, In: m.In, Out: m.Out, Seconds: m.Seconds})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Month < out[j].Month })
	return out
}

// Backfilled tells whether the months were filled from the history (the first months can then be incomplete).
func (s *Store) Backfilled() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.d.Backfilled
}

// Reset clears the totals of ONE world (audio | video); the other world is not touched.
func (s *Store) Reset(kind string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if kind == "audio" {
		s.d.Audio = Totals{}
	} else {
		s.d.Video = Totals{}
		kind = "video"
	}
	delete(s.d.Months, kind)
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
