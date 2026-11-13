package server

import (
	"encoding/json"
	"net/http"
	"path/filepath"

	"github.com/p5lukas/p5converter/internal/build"
	"github.com/p5lukas/p5converter/internal/jobs"
	"github.com/p5lukas/p5converter/internal/logs"
	"github.com/p5lukas/p5converter/internal/rename"
)

// maxJobBody: Obergrenze für einen Auftrag. Ein Stapel mit mehreren tausend Dateien ist leicht größer als 1 MB.
const maxJobBody = 16 << 20

func (s *Server) submit(w http.ResponseWriter, r *http.Request) {
	var req jobs.Request
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxJobBody)).Decode(&req); err != nil {
		httpErr(w, 400, err.Error())
		return
	}
	if req.Kind != "audio" && req.Kind != "video" {
		httpErr(w, 400, "kind muss audio oder video sein")
		return
	}
	if len(req.Items) == 0 {
		httpErr(w, 400, "keine Dateien")
		return
	}
	if err := rename.Validate(req.Output.Replace); err != nil {
		httpErr(w, 400, err.Error())
		return
	}
	if req.Output.Dir != "" {
		req.Output.Dir = filepath.Clean(req.Output.Dir)
		if !s.allowed(req.Output.Dir) {
			httpErr(w, 403, "Zielordner nicht erlaubt")
			return
		}
	}
	for i := range req.Items {
		req.Items[i].Path = filepath.Clean(req.Items[i].Path)
		if !s.allowed(req.Items[i].Path) {
			httpErr(w, 403, "Pfad nicht erlaubt: "+req.Items[i].Path)
			return
		}
		if req.Output.Dir == "" && len(s.Roots) > 0 && !s.allowed(filepath.Dir(req.Items[i].Path)) {
			httpErr(w, 403, "Zielordner nicht erlaubt")
			return
		}
	}
	// refuse hardware backends that detection did not confirm (no silent software fallback)
	if req.Kind == "video" && req.Video.Codec != "copy" && req.Video.Backend != "" && req.Video.Backend != "cpu" {
		res := s.Det.Result()
		if !res.Done {
			httpErr(w, 409, "Die Hardware-Erkennung läuft noch – bitte ein paar Sekunden warten und erneut starten.")
			return
		}
		ok := false
		for _, b := range res.Backends {
			if b.ID == req.Video.Backend && b.Codecs[req.Video.Codec] {
				ok = true
				if req.Video.Backend == "vaapi" && req.Video.VaapiDevice == "" {
					req.Video.VaapiDevice = b.Device
				}
				useDetected(&req.Video, b)
			}
		}
		if !ok {
			httpErr(w, 400, "Hardware-Encoder "+build.EncoderName(req.Video.Backend, req.Video.Codec)+" wurde nicht erkannt/funktioniert nicht. Unter „Hardware“ neu erkennen oder CPU wählen.")
			return
		}
	}
	ids := s.Jobs.Submit(&req)
	logs.Get("jobs").Infof("%d %s-Auftrag(e) eingereiht (%s)", len(ids), req.Kind, describeRequest(&req))
	writeJSON(w, map[string]any{"ids": ids})
}

// statsDir: totals are only kept on disk when the config folder is writable.
