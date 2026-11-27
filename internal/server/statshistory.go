package server

import (
	"net/http"

	"github.com/p5lukas/p5converter/internal/history"
	"github.com/p5lukas/p5converter/internal/stats"
)

// backfillStats füllt die Monatssummen beim ersten Start nach dem Update einmal aus dem Verlauf (höchstens die letzten Einträge je Art).
func (s *Server) backfillStats() {
	var past []stats.Past
	for _, k := range []string{"audio", "video"} {
		for _, e := range s.History.List(k) {
			if e.Status == "done" {
				past = append(past, stats.Past{Kind: k, Ended: e.Ended, In: e.SizeIn, Out: e.SizeOut, Seconds: e.Seconds})
			}
		}
	}
	s.Stats.Backfill(past)
}

// statsHistory liefert die Monatssummen je Art für die Grafik auf der Startseite.
func (s *Server) statsHistory(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{"audio": s.Stats.History("audio"), "video": s.Stats.History("video"), "backfilled": s.Stats.Backfilled(), "max": history.Max})
}
