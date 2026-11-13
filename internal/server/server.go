// Package server exposes the HTTP API and the embedded UI.
package server

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/p5lukas/p5converter/internal/auth"
	"github.com/p5lukas/p5converter/internal/build"
	"github.com/p5lukas/p5converter/internal/config"
	"github.com/p5lukas/p5converter/internal/ffmpeg"
	"github.com/p5lukas/p5converter/internal/history"
	"github.com/p5lukas/p5converter/internal/hw"
	"github.com/p5lukas/p5converter/internal/jobs"
	"github.com/p5lukas/p5converter/internal/logs"
	"github.com/p5lukas/p5converter/internal/stats"
	"github.com/p5lukas/p5converter/internal/version"
	"github.com/p5lukas/p5converter/web"
)

type Server struct {
	Build       version.Info
	Tools       ffmpeg.Tools
	Det         *hw.Detector
	Sampler     *hw.Sampler
	Stats       *stats.Store
	History     *history.Store
	news        *newsStore
	newsEntries []newsEntry
	Jobs        *jobs.Manager
	Auth        *auth.Manager
	Settings    *config.Store
	Roots       []string // empty = unrestricted (desktop mode)
	Quit        func()   // set in desktop mode: enables the Beenden button
	ShowWindow  func()   // set in the Windows app: a second start asks the running one to show its window
	uiOnce      sync.Once
	enc         map[string]bool
	ffver       string
	lib         libraryScans
	libCache    *libCache // Merker des Ordner-Scans
	clips       clipStore // Probeclips (Vergleich von Einstellungen an einem kurzen Ausschnitt)
}

func New(build version.Info, t ffmpeg.Tools, roots []string, concurrency int, configDir string) *Server {
	s := &Server{Build: build, Tools: t, Det: hw.NewDetector(t), Sampler: hw.NewSampler(), Roots: roots,
		Settings: config.Open(configDir), Auth: auth.New(configDir)}
	s.Jobs = jobs.New(t, s.Sampler, concurrency)
	s.Stats = stats.Open(statsDir(s.Settings, configDir))
	s.Jobs.OnDone = s.Stats.Add
	s.History = history.Open(configDir, s.Settings.Persistent())
	s.Jobs.OnFinish = func(j jobs.Job) { s.History.Add(historyEntry(j)) }
	json.Unmarshal(newsJSON, &s.newsEntries)
	s.news = openNews(configDir, s.Settings.Persistent(), s.newsEntries, build.Base)
	cfg := s.Settings.Get()
	if cfg.Concurrency > 0 { // the values saved in the settings win over the start default
		s.Jobs.SetConcurrency("video", cfg.Concurrency)
	}
	if cfg.ConcurrencyAudio > 0 {
		s.Jobs.SetConcurrency("audio", cfg.ConcurrencyAudio)
	}
	if s.Settings.Persistent() { // unfinished .part files of a crashed run are removed at start
		s.Jobs.SetPartialLog(filepath.Join(configDir, "partials.json"))
		s.Jobs.SetQueueFile(filepath.Join(configDir, "queue.json")) // jobs of an interrupted run wait for the user's decision
	}
	s.libCache = openLibCache("")
	if s.Settings.Persistent() {
		s.libCache = openLibCache(filepath.Join(configDir, "library-cache.json"))
	}
	s.enc = t.Encoders()
	s.ffver = t.Version()
	go func() {
		// P5_TEST_HW_DELAY (Millisekunden) verzögert die Erkennung künstlich – nur für Tests (die Oberfläche muss auch dann starten,
		// wenn sie schon fragt, bevor die Erkennung fertig ist)
		if ms, _ := strconv.Atoi(os.Getenv("P5_TEST_HW_DELAY")); ms > 0 {
			time.Sleep(time.Duration(ms) * time.Millisecond)
		}
		s.Det.Detect()
		logHardware(s.Det.Result())
	}()
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

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	sub, _ := fs.Sub(web.FS, ".")
	static, err := staticHandler(sub)
	if err != nil {
		panic(err) // embedded files are always readable
	}
	mux.HandleFunc("GET /{$}", s.indexPage)
	mux.HandleFunc("GET /index.html", s.indexPage)
	mux.Handle("GET /", static)
	mux.HandleFunc("GET /manifest.webmanifest", s.manifest)
	mux.HandleFunc("GET /api/news", s.newsGet)
	mux.HandleFunc("POST /api/news/seen", s.newsSeen)
	mux.HandleFunc("POST /api/stats/reset", s.statsReset)
	mux.HandleFunc("GET /api/history", s.historyList)
	mux.HandleFunc("GET /api/history.csv", s.historyCSV)
	mux.HandleFunc("POST /api/history/clear", s.historyClear)
	mux.HandleFunc("GET /api/info", s.info)
	mux.HandleFunc("POST /api/hw/detect", func(w http.ResponseWriter, r *http.Request) {
		go s.Det.Detect()
		writeJSON(w, map[string]bool{"ok": true})
	})
	mux.HandleFunc("GET /api/fs", s.browse)
	mux.HandleFunc("GET /api/fs/search", s.browseSearch)
	mux.HandleFunc("POST /api/scan", s.scan)
	mux.HandleFunc("POST /api/library/scan", s.libraryStart)
	mux.HandleFunc("GET /api/library/scan/{id}", s.libraryGet)
	mux.HandleFunc("POST /api/library/scan/{id}/cancel", s.libraryCancel)
	mux.HandleFunc("GET /api/probe", s.probe)
	mux.HandleFunc("POST /api/clip", s.clipStart)
	mux.HandleFunc("GET /api/clip/{id}", s.clipGet)
	mux.HandleFunc("POST /api/clip/{id}/cancel", s.clipCancel)
	mux.HandleFunc("GET /api/clip/{id}/img/{name}", s.clipImage)
	mux.HandleFunc("POST /api/jobs", s.submit)
	mux.HandleFunc("GET /api/state", s.state)
	mux.HandleFunc("POST /api/rename/preview", s.renamePreview)
	mux.HandleFunc("GET /api/logs", s.logFiles)
	mux.HandleFunc("GET /api/logs/alerts", s.logAlerts)
	mux.HandleFunc("GET /api/logs/read", s.logRead)
	mux.HandleFunc("GET /api/logs/download", s.logDownload)
	mux.HandleFunc("POST /api/logs/clear", s.logClear)
	mux.HandleFunc("POST /api/rename", s.renameApply)
	mux.HandleFunc("POST /api/jobs/{id}/cancel", func(w http.ResponseWriter, r *http.Request) {
		s.Jobs.Cancel(r.PathValue("id"))
		writeJSON(w, map[string]bool{"ok": true})
	})
	mux.HandleFunc("POST /api/jobs/{id}/move", func(w http.ResponseWriter, r *http.Request) {
		var b struct{ How string }
		json.NewDecoder(r.Body).Decode(&b)
		if !s.Jobs.Move(r.PathValue("id"), b.How) {
			httpErr(w, 400, "Der Auftrag lässt sich nicht verschieben")
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	})
	mux.HandleFunc("POST /api/jobs/{id}/hold", func(w http.ResponseWriter, r *http.Request) {
		var b struct{ On bool }
		json.NewDecoder(r.Body).Decode(&b)
		s.Jobs.Hold(r.PathValue("id"), b.On)
		writeJSON(w, map[string]bool{"ok": true})
	})
	mux.HandleFunc("POST /api/queue/pause", func(w http.ResponseWriter, r *http.Request) {
		var b struct{ On bool }
		json.NewDecoder(r.Body).Decode(&b)
		s.Jobs.Pause(b.On)
		logs.Get("jobs").Infof("Warteschlange %s", map[bool]string{true: "pausiert (laufende Aufträge werden fertig, es startet kein neuer)", false: "fortgesetzt"}[b.On])
		writeJSON(w, map[string]bool{"ok": true})
	})
	mux.HandleFunc("POST /api/queue/restore", func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Action string }
		json.NewDecoder(r.Body).Decode(&b)
		switch b.Action {
		case "resume":
			n := s.Jobs.Restore()
			logs.Get("jobs").Infof("%d unterbrochene(r) Auftrag/Aufträge fortgesetzt", n)
			writeJSON(w, map[string]int{"resumed": n})
		case "discard":
			s.Jobs.DiscardRestorable()
			writeJSON(w, map[string]int{"resumed": 0})
		default:
			httpErr(w, 400, "action muss resume oder discard sein")
		}
	})
	mux.HandleFunc("POST /api/jobs/cancel-all", func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Kind string }
		json.NewDecoder(r.Body).Decode(&b)
		s.Jobs.CancelAll(b.Kind)
		writeJSON(w, map[string]bool{"ok": true})
	})
	mux.HandleFunc("POST /api/jobs/clear", func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Kind string }
		json.NewDecoder(r.Body).Decode(&b)
		s.Jobs.ClearFinished(b.Kind)
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
	mux.HandleFunc("POST /api/client-error", func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Msg string }
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&b) == nil && b.Msg != "" {
			logs.Get("ui").Errorf("Fehler in der Oberfläche: %s", b.Msg)
		}
		writeJSON(w, map[string]bool{"ok": true})
	})
	mux.HandleFunc("POST /api/desktop/show", func(w http.ResponseWriter, r *http.Request) {
		if s.ShowWindow == nil {
			httpErr(w, 404, "kein App-Fenster")
			return
		}
		s.ShowWindow()
		writeJSON(w, map[string]bool{"ok": true})
	})
	mux.HandleFunc("POST /api/concurrency", func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Kind string
			N    int
		}
		json.NewDecoder(r.Body).Decode(&b)
		if b.Kind != "audio" && b.Kind != "video" {
			httpErr(w, 400, "kind muss audio oder video sein")
			return
		}
		s.Jobs.SetConcurrency(b.Kind, b.N)
		cfg := s.Settings.Get()
		cfg.Concurrency, cfg.ConcurrencyAudio = s.Jobs.Concurrency("video"), s.Jobs.Concurrency("audio")
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
	return securityHeaders(csrfGuard(s.authGuard(mux)))
}

//go:embed news.json
var newsJSON []byte

// indexPage serves the page with the version in the icon links (…png?v=0.0.9): a new version shows its new icon at once,
// browsers keep favicons for a very long time otherwise.
func (s *Server) indexPage(w http.ResponseWriter, r *http.Request) {
	b, err := web.FS.ReadFile("index.html")
	if err != nil {
		httpErr(w, 500, "Seite nicht gefunden")
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Write(bytes.ReplaceAll(b, []byte("__V__"), []byte(url.QueryEscape(s.Build.Base))))
}

// manifest makes the UI installable as an app on the home screen (iPhone/iPad: Share > Add to Home Screen).
func (s *Server) manifest(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/manifest+json")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	json.NewEncoder(w).Encode(map[string]any{
		"name": "p5converter", "short_name": "p5converter", "description": "Audio und Video konvertieren (ffmpeg, GPU)",
		"start_url": "/", "scope": "/", "display": "standalone", "orientation": "any", "lang": "de",
		"background_color": "#02100a", "theme_color": "#02100a",
		"icons": []map[string]string{
			{"src": "/icon-192.png?v=" + url.QueryEscape(s.Build.Base), "sizes": "192x192", "type": "image/png", "purpose": "any"},
			{"src": "/icon-512.png?v=" + url.QueryEscape(s.Build.Base), "sizes": "512x512", "type": "image/png", "purpose": "any"},
			{"src": "/icon-512.png?v=" + url.QueryEscape(s.Build.Base), "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
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
		"encoders": enc, "hw": s.Det.Result(), "concurrency": s.concurrencies(), "canQuit": s.Quit != nil,
		"config": map[string]any{"persistent": s.Settings.Persistent(), "dir": s.Settings.Dir()}, "authEnabled": s.Auth.Enabled(),
	})
}

func statsDir(c *config.Store, dir string) string {
	if c.Persistent() {
		return dir
	}
	return ""
}

func (s *Server) concurrencies() map[string]int {
	return map[string]int{"audio": s.Jobs.Concurrency("audio"), "video": s.Jobs.Concurrency("video")}
}

func (s *Server) state(w http.ResponseWriter, r *http.Request) {
	// einmal protokollieren, womit die Oberfläche läuft (zeigt z. B. „Edg/…“ = WebView2-Fenster der Windows-App)
	s.uiOnce.Do(func() { logs.Get("app").Infof("Oberfläche verbunden (%s)", shortUA(r.UserAgent())) })
	writeJSON(w, map[string]any{
		"jobs": s.Jobs.Snapshot(), "finished": s.Jobs.Finished(), "stats": s.Sampler.Latest(), "concurrency": s.concurrencies(), "saved": s.Stats.Get(),
		"paused": s.Jobs.Paused(), "restorable": s.Jobs.Restorable(),
	})
}

func useDetected(v *build.VideoOpts, b hw.Backend) {
	v.HWInit = b.Init
	if b.ID == "qsv" {
		if b.DecodeTested && !b.DecodeOK {
			v.HWDecode = false
		} else {
			v.HWDecodeInit = b.DecodeInit
		}
	}
}

// logHardware writes the result of the hardware detection into the log.
func logHardware(res hw.Result) {
	l := logs.Get("hw")
	for _, b := range res.Backends {
		var ok []string
		for c, works := range b.Codecs {
			if works {
				ok = append(ok, c)
			}
		}
		sort.Strings(ok)
		if len(ok) > 0 {
			l.Infof("%s nutzbar (%s)%s", b.Label, strings.Join(ok, ", "), map[bool]string{true: ", Start: " + b.Variant, false: ""}[b.Variant != ""])
		} else if b.ID != "cpu" && b.Compiled && !hw.MaybePresent(res.GPUs, b.ID) {
			l.Infof("%s nicht nutzbar (keine passende Grafikeinheit gefunden): %s", b.Label, b.Detail) // kein Grund zur Warnung
		} else if b.ID != "cpu" && b.Compiled {
			l.Warnf("%s nicht nutzbar: %s", b.Label, b.Detail)
		} else if b.ID != "cpu" {
			l.Debugf("%s: %s", b.Label, b.Detail)
		}
	}
	l.Infof("Hardware-Erkennung fertig in %.1f s; Grafik/Videoeinheiten: %s; Render-Geräte: %s", float64(res.TookMs)/1000, strings.Join(res.GPUs, ", "), strings.Join(res.Devices, ", "))
}

func describeRequest(req *jobs.Request) string {
	if req.Kind == "audio" {
		return "Format " + req.Audio.Format
	}
	if req.Video.Codec == "copy" {
		return "Video kopiert"
	}
	return req.Video.Codec + " mit " + req.Video.Backend
}

// statsReset setzt die gewonnene-Platz-Zählung EINER Welt zurück (audio | video).
func (s *Server) statsReset(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Kind string `json:"kind"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<12)).Decode(&body) != nil || (body.Kind != "audio" && body.Kind != "video") {
		http.Error(w, `{"error":"Art fehlt (audio oder video)"}`, 400)
		return
	}
	s.Stats.Reset(body.Kind)
	logs.Get("app").Infof("Statistik „Gewonnener Platz“ zurückgesetzt (%s)", body.Kind)
	writeJSON(w, map[string]any{"ok": true, "saved": s.Stats.Get()})
}

// shortUA kürzt den User-Agent auf die Browser-Kennung (letzte zwei Teile, z. B. "Chrome/154.0.0.0 Edg/154.0.0.0").
func shortUA(ua string) string {
	f := strings.Fields(ua)
	if len(f) > 2 {
		f = f[len(f)-2:]
	}
	return strings.Join(f, " ")
}
