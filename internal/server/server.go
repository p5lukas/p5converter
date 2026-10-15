// Package server exposes the HTTP API and the embedded UI.
package server

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/p5lukas/p5converter/internal/auth"
	"github.com/p5lukas/p5converter/internal/build"
	"github.com/p5lukas/p5converter/internal/config"
	"github.com/p5lukas/p5converter/internal/ffmpeg"
	"github.com/p5lukas/p5converter/internal/hw"
	"github.com/p5lukas/p5converter/internal/jobs"
	"github.com/p5lukas/p5converter/internal/rename"
	"github.com/p5lukas/p5converter/internal/version"
	"github.com/p5lukas/p5converter/web"
)

type Server struct {
	Build    version.Info
	Tools    ffmpeg.Tools
	Det      *hw.Detector
	Sampler  *hw.Sampler
	Jobs     *jobs.Manager
	Auth     *auth.Manager
	Settings *config.Store
	Roots    []string // empty = unrestricted (desktop mode)
	Quit     func()   // set in desktop mode: enables the Beenden button
	enc      map[string]bool
	ffver    string
}

func New(build version.Info, t ffmpeg.Tools, roots []string, concurrency int, configDir string) *Server {
	s := &Server{Build: build, Tools: t, Det: hw.NewDetector(t), Sampler: hw.NewSampler(), Roots: roots,
		Settings: config.Open(configDir), Auth: auth.New(configDir)}
	if c := s.Settings.Get().Concurrency; c > 0 {
		concurrency = c // the value saved in the settings wins over the start default
	}
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
	static := http.FileServerFS(sub)
	mux.Handle("GET /", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache") // always revalidate (ETag): new versions show up immediately
		static.ServeHTTP(w, r)
	}))
	mux.HandleFunc("GET /manifest.webmanifest", s.manifest)
	mux.HandleFunc("GET /api/news", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.Write(newsJSON)
	})
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
	mux.HandleFunc("POST /api/rename/preview", s.renamePreview)
	mux.HandleFunc("POST /api/rename", s.renameApply)
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
		cfg := s.Settings.Get()
		cfg.Concurrency = s.Jobs.Concurrency()
		s.Settings.Put(cfg)
		writeJSON(w, map[string]bool{"ok": true})
	})
	mux.HandleFunc("GET /api/settings", s.getSettings)
	mux.HandleFunc("PUT /api/settings", s.putSettings)
	mux.HandleFunc("GET /api/settings/defaults", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, config.Defaults()) })
	mux.HandleFunc("GET /api/auth/state", s.authState)
	mux.HandleFunc("POST /api/auth/login", s.authLogin)
	mux.HandleFunc("POST /api/auth/logout", s.authLogout)
	mux.HandleFunc("POST /api/auth/setup", s.authSetup)
	mux.HandleFunc("POST /api/auth/change", s.authChange)
	mux.HandleFunc("POST /api/auth/disable", s.authDisable)
	return csrfGuard(s.authGuard(mux))
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

//go:embed news.json
var newsJSON []byte

// manifest makes the UI installable as an app on the home screen (iPhone/iPad: Share > Add to Home Screen).
func (s *Server) manifest(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/manifest+json")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	json.NewEncoder(w).Encode(map[string]any{
		"name": "p5converter", "short_name": "p5converter", "description": "Audio und Video konvertieren (ffmpeg, GPU)",
		"start_url": "/", "scope": "/", "display": "standalone", "orientation": "any", "lang": "de",
		"background_color": "#02100a", "theme_color": "#02100a",
		"icons": []map[string]string{
			{"src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
			{"src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
			{"src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
		},
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
		"version": s.Build.Version, "build": s.Build, "ffmpeg": s.ffver, "os": runtime.GOOS, "roots": s.Roots, "home": home,
		"encoders": enc, "hw": s.Det.Result(), "concurrency": s.Jobs.Concurrency(), "canQuit": s.Quit != nil,
		"config": map[string]any{"persistent": s.Settings.Persistent(), "dir": s.Settings.Dir()}, "authEnabled": s.Auth.Enabled(),
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
			if k := mediaKind(d.Name()); k == b.Kind || (b.Kind == "media" && k != "") {
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
				req.Video.HWInit = b.Init // e.g. Quick Sync started via a VAAPI device
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
		s.Jobs.SetConcurrency(out.Concurrency)
	}
	writeJSON(w, map[string]any{"settings": out, "persistent": s.Settings.Persistent()})
}

// -------------------------------------------------------------------- auth ---

func (s *Server) sessionToken(r *http.Request) string {
	if c, err := r.Cookie(auth.CookieName()); err == nil {
		return c.Value
	}
	return ""
}

// authGuard protects the API when the login is on. The static page, the manifest and the login calls stay public.
func (s *Server) authGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		public := !strings.HasPrefix(p, "/api/") || p == "/api/auth/state" || p == "/api/auth/login" ||
			p == "/api/auth/setup" || p == "/api/auth/logout"
		if !public && s.Auth.Enabled() && !s.Auth.Valid(s.sessionToken(r)) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(map[string]any{"error": "Anmeldung erforderlich", "login": true})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) authStateOf(r *http.Request) map[string]any {
	return s.authStateTok(s.sessionToken(r))
}

func (s *Server) authStateTok(token string) map[string]any {
	enabled := s.Auth.Enabled()
	ok := !enabled || s.Auth.Valid(token)
	st := map[string]any{"enabled": enabled, "authenticated": ok, "fun": s.Auth.Fun(), "persistent": s.Settings.Persistent()}
	if enabled && ok {
		st["user"] = s.Auth.User()
	}
	return st
}

func (s *Server) authState(w http.ResponseWriter, r *http.Request) { writeJSON(w, s.authStateOf(r)) }

func clientIP(r *http.Request) string {
	h, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return h
}

func setSessionCookie(w http.ResponseWriter, r *http.Request, token string, maxAge int, remember bool) {
	c := &http.Cookie{Name: auth.CookieName(), Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode,
		Secure: r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"}
	if remember {
		c.MaxAge = maxAge
	}
	http.SetCookie(w, c)
}

func (s *Server) authLogin(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Remember bool   `json:"remember"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&b) != nil {
		httpErr(w, 400, "Ungültige Anfrage")
		return
	}
	tok, life, err := s.Auth.Login(b.Username, b.Password, clientIP(r), b.Remember)
	if err != nil {
		var be *auth.BlockedError
		switch {
		case errors.As(err, &be):
			w.Header().Set("Retry-After", strconv.Itoa(int(be.Wait.Seconds())+1))
			httpErr(w, 429, err.Error())
		case errors.Is(err, auth.ErrNotEnabled):
			httpErr(w, 400, err.Error())
		default:
			httpErr(w, 401, err.Error())
		}
		return
	}
	setSessionCookie(w, r, tok, life, b.Remember)
	writeJSON(w, map[string]any{"ok": true, "state": map[string]any{"enabled": true, "authenticated": true, "user": s.Auth.User(), "fun": s.Auth.Fun()}})
}

func (s *Server) authLogout(w http.ResponseWriter, r *http.Request) {
	if t := s.sessionToken(r); t != "" {
		s.Auth.Logout(t)
	}
	http.SetCookie(w, &http.Cookie{Name: auth.CookieName(), Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode})
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) authSetup(w http.ResponseWriter, r *http.Request) {
	var b struct{ Username, Password string }
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&b) != nil {
		httpErr(w, 400, "Ungültige Anfrage")
		return
	}
	if err := s.Auth.Setup(b.Username, b.Password); err != nil {
		httpErr(w, 400, err.Error())
		return
	}
	// log the person in right away, otherwise they would lock themselves out of the page they are on
	tok := ""
	if t, life, err := s.Auth.Login(b.Username, b.Password, clientIP(r), false); err == nil {
		tok = t
		setSessionCookie(w, r, tok, life, false)
	}
	writeJSON(w, s.authStateTok(tok))
}

func (s *Server) authChange(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Current     string `json:"current"`
		Username    string `json:"username"`
		NewPassword string `json:"newPassword"`
		Fun         *bool  `json:"fun"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&b) != nil {
		httpErr(w, 400, "Ungültige Anfrage")
		return
	}
	if b.Fun != nil && b.Current == "" && b.Username == "" && b.NewPassword == "" { // the fun switch needs no password
		if err := s.Auth.SetFun(*b.Fun); err != nil {
			httpErr(w, 400, err.Error())
			return
		}
		writeJSON(w, s.authStateOf(r))
		return
	}
	if err := s.Auth.Change(b.Current, b.Username, b.NewPassword); err != nil {
		httpErr(w, 400, err.Error())
		return
	}
	// all sessions ended: sign this browser in again with the new data
	user := b.Username
	if strings.TrimSpace(user) == "" {
		user = s.Auth.User()
	}
	pw := b.NewPassword
	if pw == "" {
		pw = b.Current
	}
	tok := ""
	if t, life, err := s.Auth.Login(user, pw, clientIP(r), false); err == nil {
		tok = t
		setSessionCookie(w, r, tok, life, false)
	}
	writeJSON(w, s.authStateTok(tok))
}

func (s *Server) authDisable(w http.ResponseWriter, r *http.Request) {
	var b struct{ Password string }
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&b) != nil {
		httpErr(w, 400, "Ungültige Anfrage")
		return
	}
	if err := s.Auth.Disable(b.Password); err != nil {
		httpErr(w, 400, err.Error())
		return
	}
	http.SetCookie(w, &http.Cookie{Name: auth.CookieName(), Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode})
	writeJSON(w, s.authStateOf(r))
}
