package server

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/p5lukas/p5converter/internal/history"
	"github.com/p5lukas/p5converter/internal/jobs"
)

// historyEntry turns a finished job into a history entry. Command and log lines are only kept for errors.
func historyEntry(j jobs.Job) history.Entry {
	e := history.Entry{ID: fmt.Sprintf("%d-%s", j.Ended.UnixNano(), j.ID), Kind: j.Kind, Name: j.Name, Input: j.Input, Output: j.Output,
		Status: j.Status, Ended: j.Ended, SizeIn: j.SizeIn, SizeOut: j.SizeOut, Backend: j.Backend, Encoder: j.Encoder, Decoder: j.Decoder, EncoderOK: j.EncoderConfirmed, DecoderOK: j.DecoderConfirmed,
		Error: j.Error, Warnings: j.Warnings, CheckBad: j.CheckFailed}
	if !j.Started.IsZero() && !j.Ended.IsZero() {
		e.Seconds = int(j.Ended.Sub(j.Started).Round(time.Second) / time.Second)
	}
	for _, c := range j.Checks {
		e.Checks = append(e.Checks, history.Check{Name: c.Name, OK: c.OK, Note: c.Note})
	}
	if j.Status == "error" {
		e.Cmd = j.Cmd
		e.Log = j.Log
		if len(e.Log) > 15 {
			e.Log = e.Log[len(e.Log)-15:]
		}
	}
	return e
}

func historyKind(w http.ResponseWriter, r *http.Request) (string, bool) {
	k := r.URL.Query().Get("kind")
	if k != "audio" && k != "video" {
		httpErr(w, 400, "kind muss audio oder video sein")
		return "", false
	}
	return k, true
}

func (s *Server) historyList(w http.ResponseWriter, r *http.Request) {
	k, ok := historyKind(w, r)
	if !ok {
		return
	}
	writeJSON(w, map[string]any{"items": s.History.List(k), "max": history.Max, "persistent": s.History.Persistent()})
}

func (s *Server) historyClear(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Kind string `json:"kind"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&b) != nil || (b.Kind != "audio" && b.Kind != "video") {
		httpErr(w, 400, "kind muss audio oder video sein")
		return
	}
	s.History.Clear(b.Kind)
	writeJSON(w, map[string]any{"ok": true})
}

// csvCell protects against formulas: Excel/LibreOffice run cells that start with = + - @.
func csvCell(v string) string {
	if v != "" && strings.ContainsAny(v[:1], "=+-@\t\r") {
		return "'" + v
	}
	return v
}

var statusDE = map[string]string{"done": "fertig", "error": "Fehler", "canceled": "abgebrochen", "skipped": "übersprungen"}

func (s *Server) historyCSV(w http.ResponseWriter, r *http.Request) {
	k, ok := historyKind(w, r)
	if !ok {
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="p5converter-verlauf-%s.csv"`, k))
	w.Write([]byte("\xEF\xBB\xBF")) // Excel erkennt so UTF-8
	cw := csv.NewWriter(w)
	cw.Comma = ';' // deutsches Excel
	cw.Write([]string{"Ende", "Datei", "Quelle", "Ziel", "Ergebnis", "Größe vorher (Bytes)", "Größe nachher (Bytes)", "Dauer (s)", "Encoder", "Prüfung", "Fehler"})
	for _, e := range s.History.List(k) {
		check := ""
		if len(e.Checks) > 0 {
			check = "bestanden"
			if e.CheckBad {
				check = "NICHT bestanden"
			}
		}
		st := statusDE[e.Status]
		if st == "" {
			st = e.Status
		}
		cw.Write([]string{e.Ended.Local().Format("2006-01-02 15:04:05"), csvCell(e.Name), csvCell(e.Input), csvCell(e.Output), st,
			fmt.Sprint(e.SizeIn), fmt.Sprint(e.SizeOut), fmt.Sprint(e.Seconds), csvCell(e.Encoder), check, csvCell(e.Error)})
	}
	cw.Flush()
}
