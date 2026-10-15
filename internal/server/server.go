// Package server exposes the HTTP API and the embedded UI.
package server

import (
	"context"
	"encoding/json"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/p5lukas/p5converter/internal/build"
	"github.com/p5lukas/p5converter/internal/ffmpeg"
	"github.com/p5lukas/p5converter/internal/hw"
	"github.com/p5lukas/p5converter/internal/jobs"
	"github.com/p5lukas/p5converter/web"
)

type Server struct {
	Version string
	Tools   ffmpeg.Tools
	Det     *hw.Detector
	Sampler *hw.Sampler
	Jobs    *jobs.Manager
	Roots   []string // empty = unrestricted (desktop mode)
	Quit    func()   // set in desktop mode: enables the Beenden button
	enc     map[string]bool
	ffver   string
}

func New(version string, t ffmpeg.Tools, roots []string, concurrency int) *Server {
	s := &Server{Version: version, Tools: t, Det: hw.NewDetector(t), Sampler: hw.NewSampler(), Roots: roots}
	s.Jobs = jobs.New(t, s.Sampler, concurrency)
	s.enc = t.Encoders()
	s.ffver = t.Version()
	go s.Det.Detect()
	return s
}

var audioExt = map[string]bool{".mp3": true, ".flac": true, ".ogg": true, ".oga": true, ".opus": true, ".wav": true, ".m4a": true,
	".aac": true, ".wma": true, ".aiff": true, ".aif": true, ".ape": true, ".wv": true, ".mka": true, ".m4b": true, ".ac3": true}
var videoExt = map[string]bool{".mkv": true, ".mp4": true, ".avi": true, ".mov": true, ".wmv": true, ".flv": true, ".webm": true,
	".m4v": true, ".ts": true, ".m2ts": true, ".mts": true, ".mpg": true, ".mpeg": true, ".ogv": true, ".3gp": true, ".vob": true}

func mediaKind(name string) string {
	e := strings.ToLower(filepath.Ext(name))
	switch {
	case audioExt[e]:
		return "audio"
	case videoExt[e]:
		return "video"
	}
	return ""
}

func (s *Server) allowed(p string) bool {
	if len(s.Roots) == 0 {
		return true
	}
	p = filepath.Clean(p)
	for _, r := range s.Roots {
		r = filepath.Clean(r)
		if p == r || strings.HasPrefix(p, r+string(filepath.Separator)) {
			return true
		}
	}
	return false
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	sub, _ := fs.Sub(web.FS, ".")
	mux.Handle("GET /", http.FileServerFS(sub))
	mux.HandleFunc("GET /api/info", s.info)
	mux.HandleFunc("POST /api/hw/detect", func(w http.ResponseWriter, r *http.Request) {
		go s.Det.Detect()
		writeJSON(w, map[string]bool{"ok": true})
	})
	mux.HandleFunc("GET /api/fs", s.browse)
	mux.HandleFunc("POST /api/scan", s.scan)
	mux.HandleFunc("GET /api/probe", s.probe)
	mux.HandleFunc("POST /api/jobs", s.submit)
	mux.HandleFunc("GET /api/state", s.state)
	mux.HandleFunc("POST /api/jobs/{id}/cancel", func(w http.ResponseWriter, r *http.Request) {
		s.Jobs.Cancel(r.PathValue("id"))
		writeJSON(w, map[string]bool{"ok": true})
	})
	mux.HandleFunc("POST /api/jobs/cancel-all", func(w http.ResponseWriter, r *http.Request) {
		s.Jobs.CancelAll()
		writeJSON(w, map[string]bool{"ok": true})
	})
	mux.HandleFunc("POST /api/jobs/clear", func(w http.ResponseWriter, r *http.Request) {
		s.Jobs.ClearFinished()
		writeJSON(w, map[string]bool{"ok": true})
	})
	mux.HandleFunc("POST /api/quit", func(w http.ResponseWriter, r *http.Request) {
		if s.Quit == nil {
			httpErr(w, 403, "Beenden ist hier nicht erlaubt")
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
		go s.Quit()
	})
	mux.HandleFunc("POST /api/concurrency", func(w http.ResponseWriter, r *http.Request) {
		var b struct{ N int }
		json.NewDecoder(r.Body).Decode(&b)
		s.Jobs.SetConcurrency(b.N)
		writeJSON(w, map[string]bool{"ok": true})
	})
	return csrfGuard(mux)
}

// csrfGuard blocks cross-site requests: state-changing calls must be JSON (forces a CORS
// preflight we never answer) and, if an Origin header is present, must come from this host.
func csrfGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
				httpErr(w, 415, "Content-Type application/json erforderlich")
				return
			}
		}
		if o := r.Header.Get("Origin"); o != "" {
			u, err := url.Parse(o)
			if err != nil || u.Host != r.Host {
				httpErr(w, 403, "Cross-Origin-Anfrage abgelehnt")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(v)
}

func httpErr(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func (s *Server) info(w http.ResponseWriter, r *http.Request) {
	home, _ := os.UserHomeDir()
	if len(s.Roots) > 0 {
		home = s.Roots[0]
	}
	keys := []string{"libx264", "libx265", "libsvtav1", "libaom-av1", "libvpx-vp9", "libmp3lame", "libvorbis", "libopus", "aac", "flac", "ac3", "eac3"}
	enc := map[string]bool{}
	for _, k := range keys {
		enc[k] = s.enc[k]
	}
	writeJSON(w, map[string]any{
		"version": s.Version, "ffmpeg": s.ffver, "os": runtime.GOOS, "roots": s.Roots, "home": home,
		"encoders": enc, "hw": s.Det.Result(), "concurrency": s.Jobs.Concurrency(), "canQuit": s.Quit != nil,
	})
}

type fsEntry struct {
	Name  string `json:"name"`
	Dir   bool   `json:"dir"`
	Size  int64  `json:"size,omitempty"`
	Media string `json:"media,omitempty"`
}

func (s *Server) browse(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("path")
	if p == "" {
		if len(s.Roots) > 0 {
			var es []fsEntry
			for _, root := range s.Roots {
				es = append(es, fsEntry{Name: root, Dir: true})
			}
			writeJSON(w, map[string]any{"path": "", "parent": "", "entries": es, "roots": true})
			return
		}
		p, _ = os.UserHomeDir()
	}
	p = filepath.Clean(p)
	if !s.allowed(p) {
		httpErr(w, 403, "Pfad nicht erlaubt")
		return
	}
	ents, err := os.ReadDir(p)
	if err != nil {
		httpErr(w, 400, err.Error())
		return
	}
	var out []fsEntry
	for _, e := range ents {
		if strings.HasPrefix(e.Name(), ".") {
			continue
		}
		isDir := e.IsDir()
		if e.Type()&os.ModeSymlink != 0 {
			if st, err := os.Stat(filepath.Join(p, e.Name())); err == nil {
				isDir = st.IsDir()
			}
		}
		if isDir {
			out = append(out, fsEntry{Name: e.Name(), Dir: true})
		} else if k := mediaKind(e.Name()); k != "" {
			var size int64
			if inf, err := e.Info(); err == nil {
				size = inf.Size()
			}
			out = append(out, fsEntry{Name: e.Name(), Size: size, Media: k})
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Dir != out[j].Dir {
			return out[i].Dir
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	parent := filepath.Dir(p)
	if parent == p || !s.allowed(parent) {
		parent = ""
	}
	resp := map[string]any{"path": p, "parent": parent, "entries": out}
	if runtime.GOOS == "windows" {
		var drives []string
		for c := 'A'; c <= 'Z'; c++ {
			d := string(c) + `:\`
			if _, err := os.Stat(d); err == nil {
				drives = append(drives, d)
			}
		}
		resp["drives"] = drives
	}
	writeJSON(w, resp)
}

type scanFile struct {
	Path string `json:"path"`
	Rel  string `json:"rel"`
	Size int64  `json:"size"`
}

func (s *Server) scan(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Paths []string `json:"paths"`
		Kind  string   `json:"kind"`
	}
	if json.NewDecoder(r.Body).Decode(&b) != nil {
		httpErr(w, 400, "bad json")
		return
	}
	var files []scanFile
	for _, p := range b.Paths {
		p = filepath.Clean(p)
		if !s.allowed(p) {
			httpErr(w, 403, "Pfad nicht erlaubt: "+p)
			return
		}
		st, err := os.Stat(p)
		if err != nil {
			continue
		}
		if !st.IsDir() {
			files = append(files, scanFile{p, filepath.Base(p), st.Size()})
			continue
		}
		base := filepath.Base(p)
		filepath.WalkDir(p, func(fp string, d fs.DirEntry, err error) error {
			if err != nil || len(files) > 20000 {
				return nil
			}
			if d.IsDir() {
				if strings.HasPrefix(d.Name(), ".") && fp != p {
					return filepath.SkipDir
				}
				return nil
			}
			if k := mediaKind(d.Name()); k == b.Kind {
				rel, _ := filepath.Rel(p, fp)
				var size int64
				if inf, err := d.Info(); err == nil {
					size = inf.Size()
				}
				files = append(files, scanFile{fp, filepath.ToSlash(filepath.Join(base, rel)), size})
			}
			return nil
		})
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Rel < files[j].Rel })
	writeJSON(w, map[string]any{"files": files})
}

func (s *Server) probe(w http.ResponseWriter, r *http.Request) {
	p := filepath.Clean(r.URL.Query().Get("path"))
	if !s.allowed(p) {
		httpErr(w, 403, "Pfad nicht erlaubt")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	info, err := s.Tools.Probe(ctx, p)
	if err != nil {
		httpErr(w, 400, err.Error())
		return
	}
	writeJSON(w, info)
}

func (s *Server) submit(w http.ResponseWriter, r *http.Request) {
	var req jobs.Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
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
			}
		}
		if !ok {
			httpErr(w, 400, "Hardware-Encoder "+build.EncoderName(req.Video.Backend, req.Video.Codec)+" wurde nicht erkannt/funktioniert nicht. Unter „Hardware“ neu erkennen oder CPU wählen.")
			return
		}
	}
	ids := s.Jobs.Submit(&req)
	writeJSON(w, map[string]any{"ids": ids})
}

func (s *Server) state(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{
		"jobs": s.Jobs.Snapshot(), "stats": s.Sampler.Latest(), "concurrency": s.Jobs.Concurrency(),
	})
}
