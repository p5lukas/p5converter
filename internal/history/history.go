// Package history keeps the list of finished conversions (per world, the last Max entries) in the config folder.
package history

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Max is the number of entries kept per world; older ones drop out.
const Max = 100

type Check struct {
	Name string `json:"name"`
	OK   bool   `json:"ok"`
	Note string `json:"note"`
}

// Entry is one finished job (status: done, error, canceled, skipped).
type Entry struct {
	ID      string    `json:"id"`
	Kind    string    `json:"kind"` // audio | video
	Name    string    `json:"name"`
	Input   string    `json:"input"`
	Output  string    `json:"output"`
	Status  string    `json:"status"`
	Ended   time.Time `json:"ended"`
	Seconds int       `json:"seconds"` // running time
	SizeIn  int64     `json:"sizeIn"`
	SizeOut int64     `json:"sizeOut"`
	Backend string    `json:"backend,omitempty"`
	Encoder string    `json:"encoder,omitempty"`
	Decoder string    `json:"decoder,omitempty"`
	// EncoderOK/DecoderOK: ffmpeg itself confirmed the hardware encoder/decoder (the green check marks)
	EncoderOK bool     `json:"encoderOk,omitempty"`
	DecoderOK bool     `json:"decoderOk,omitempty"`
	Error     string   `json:"error,omitempty"`
	Warnings  []string `json:"warnings,omitempty"`
	Checks    []Check  `json:"checks,omitempty"`
	CheckBad  bool     `json:"checkFailed,omitempty"`
	Cmd       string   `json:"cmd,omitempty"` // only kept for errors
	Log       []string `json:"log,omitempty"` // only kept for errors (last lines)
}

type Store struct {
	mu         sync.Mutex
	file       string
	persistent bool
	items      map[string][]Entry // per kind, newest first
}

// Open loads the history from dir/history.json. dir == "" or not writable: it stays in memory only.
func Open(dir string, persistent bool) *Store {
	s := &Store{items: map[string][]Entry{"audio": nil, "video": nil}, persistent: persistent && dir != ""}
	if s.persistent {
		s.file = filepath.Join(dir, "history.json")
		if b, err := os.ReadFile(s.file); err == nil {
			var m map[string][]Entry
			if json.Unmarshal(b, &m) == nil {
				for k, v := range m {
					if k == "audio" || k == "video" {
						if len(v) > Max {
							v = v[:Max]
						}
						s.items[k] = v
					}
				}
			}
		}
	}
	return s
}

func (s *Store) Persistent() bool { return s.persistent }

// Add puts e at the top of its world's list and drops entries beyond Max.
func (s *Store) Add(e Entry) {
	if e.Kind != "audio" && e.Kind != "video" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	l := append([]Entry{e}, s.items[e.Kind]...)
	if len(l) > Max {
		l = l[:Max]
	}
	s.items[e.Kind] = l
	s.saveLocked()
}

// List returns a copy of one world's entries, newest first.
func (s *Store) List(kind string) []Entry {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]Entry{}, s.items[kind]...)
}

// Clear empties one world's history; the other world stays.
func (s *Store) Clear(kind string) {
	if kind != "audio" && kind != "video" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.items[kind] = nil
	s.saveLocked()
}

func (s *Store) saveLocked() {
	if !s.persistent {
		return
	}
	b, err := json.Marshal(s.items)
	if err != nil {
		return
	}
	tmp := s.file + ".tmp"
	if os.WriteFile(tmp, b, 0o644) == nil {
		os.Rename(tmp, s.file)
	}
}
