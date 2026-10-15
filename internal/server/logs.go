package server

import (
	"encoding/json"
	"net/http"
	"os"
	"strconv"

	"github.com/p5lukas/p5converter/internal/logs"
)

func (s *Server) logFiles(w http.ResponseWriter, r *http.Request) { writeJSON(w, logs.Files()) }

func (s *Server) logAlerts(w http.ResponseWriter, r *http.Request) {
	since, _ := strconv.ParseInt(r.URL.Query().Get("since"), 10, 64)
	writeJSON(w, logs.Alerts(since))
}

func (s *Server) logRead(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	name := q.Get("file")
	if name == "" {
		name = logs.Name
	}
	tail, _ := strconv.Atoi(q.Get("tail"))
	off, err := strconv.ParseInt(q.Get("offset"), 10, 64)
	res, e := logs.Read(name, tail, off, err == nil && q.Get("offset") != "")
	if e != nil {
		httpErr(w, 400, e.Error())
		return
	}
	if res.Entries == nil {
		res.Entries = []logs.Entry{}
	}
	writeJSON(w, res)
}

func (s *Server) logDownload(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("file")
	if name == "" {
		name = logs.Name
	}
	p, err := logs.Path(name)
	if err != nil {
		if os.IsNotExist(err) {
			httpErr(w, 404, "Keine Logdatei (kein Konfigurationsordner eingehängt)")
		} else {
			httpErr(w, 400, err.Error())
		}
		return
	}
	if _, err := os.Stat(p); err != nil {
		httpErr(w, 404, "Logdatei nicht gefunden")
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	http.ServeFile(w, r, p)
}

func (s *Server) logClear(w http.ResponseWriter, r *http.Request) {
	var b struct{ File string }
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&b); err != nil {
		httpErr(w, 400, "Ungültige Anfrage")
		return
	}
	if b.File == "" {
		b.File = logs.Name
	}
	if err := logs.Clear(b.File); err != nil {
		httpErr(w, 400, err.Error())
		return
	}
	logs.Get("app").Infof("Logdatei geleert: %s", b.File)
	writeJSON(w, map[string]bool{"ok": true})
}
