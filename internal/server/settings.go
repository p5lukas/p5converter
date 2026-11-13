package server

import (
	"encoding/json"
	"net/http"

	"github.com/p5lukas/p5converter/internal/config"
	"github.com/p5lukas/p5converter/internal/logs"
)

// ---------------------------------------------------------------- settings ---

func (s *Server) getSettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{"settings": s.Settings.Get(), "persistent": s.Settings.Persistent(), "dir": s.Settings.Dir()})
}

func (s *Server) putSettings(w http.ResponseWriter, r *http.Request) {
	var in config.Settings
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&in); err != nil {
		httpErr(w, 400, "Ungültige Einstellungen")
		return
	}
	out, err := s.Settings.Put(in)
	if err != nil {
		httpErr(w, 400, err.Error())
		return
	}
	if out.Concurrency > 0 {
		s.Jobs.SetConcurrency("video", out.Concurrency)
	}
	if out.ConcurrencyAudio > 0 {
		s.Jobs.SetConcurrency("audio", out.ConcurrencyAudio)
	}
	logs.Get("settings").Infof("Einstellungen gespeichert")
	writeJSON(w, map[string]any{"settings": out, "persistent": s.Settings.Persistent()})
}
