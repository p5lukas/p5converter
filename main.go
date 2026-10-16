package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/p5lukas/p5converter/internal/auth"
	"github.com/p5lukas/p5converter/internal/ffmpeg"
	"github.com/p5lukas/p5converter/internal/logs"
	"github.com/p5lukas/p5converter/internal/server"
	"github.com/p5lukas/p5converter/internal/version"
)

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func main() {
	// p5converter auth reset  – removes the login (forgotten password; needs access to the server)
	if len(os.Args) >= 3 && os.Args[1] == "auth" && os.Args[2] == "reset" {
		dir := env("P5_CONFIG", "")
		if dir == "" {
			if d, err := os.UserConfigDir(); err == nil {
				dir = filepath.Join(d, "p5converter")
			}
		}
		if err := auth.Reset(dir); err != nil {
			fmt.Fprintln(os.Stderr, "Fehler:", err)
			os.Exit(1)
		}
		fmt.Println("Anmeldung zurückgesetzt (" + dir + "). Beim nächsten Öffnen kann in den Einstellungen eine neue angelegt werden.")
		return
	}
	addr := flag.String("listen", env("P5_LISTEN", "127.0.0.1:8787"), "Adresse:Port (Docker: 0.0.0.0:8787)")
	roots := flag.String("roots", env("P5_ROOTS", ""), "erlaubte Wurzelordner, kommagetrennt (leer = alles erlaubt)")
	cfgFlag := flag.String("config", env("P5_CONFIG", ""), "Ordner für Einstellungen und Anmeldung (Docker: /config)")
	ffdir := flag.String("ffmpeg-dir", env("P5_FFMPEG_DIR", ""), "Ordner mit ffmpeg/ffprobe")
	noBrowser := flag.Bool("no-browser", env("P5_NO_BROWSER", "") != "", "Fenster/Browser nicht automatisch öffnen")
	conc, _ := strconv.Atoi(env("P5_JOBS", "1"))
	jobsN := flag.Int("jobs", conc, "parallele Konvertierungen")
	showVersion := flag.Bool("version", false, "Version anzeigen")
	health := flag.Bool("healthcheck", false, "Docker-Healthcheck: Exit 0 wenn der Server antwortet")
	flag.Parse()
	if *health {
		c := http.Client{Timeout: 3 * time.Second}
		resp, err := c.Get(urlFor(*addr) + "/api/info")
		if err != nil || resp.StatusCode >= 500 {
			os.Exit(1)
		}
		return
	}
	if *showVersion {
		fmt.Println("p5converter", version.Get().Version)
		return
	}

	// Desktop mode = started by a person on their own machine (not Docker/server with fixed roots).
	desktop := strings.TrimSpace(*roots) == "" && !*noBrowser
	setupLog(desktop)
	if desktop {
		setupDesktop()
	}
	cfgDir := *cfgFlag
	if cfgDir == "" && desktop {
		if d, err := os.UserConfigDir(); err == nil {
			cfgDir = filepath.Join(d, "p5converter")
		}
	}
	logs.Setup(cfgDir) // Logdatei in <Konfig>/logs, ohne Ordner nur im Speicher
	log.SetFlags(0)
	log.SetOutput(logs.Writer("app"))
	if os.Getenv("P5_AUTH_RESET") == "1" && cfgDir != "" {
		if err := auth.Reset(cfgDir); err == nil {
			log.Print("P5_AUTH_RESET=1: Anmeldung zurückgesetzt. Variable bitte wieder entfernen.")
		}
	}
	if cfgDir == "" {
		log.Print("Hinweis: kein Konfigurationsordner (P5_CONFIG/ /config) – Einstellungen werden nicht dauerhaft gespeichert.")
	}

	tools, err := ffmpeg.Locate(*ffdir)
	if err != nil {
		fatal(desktop, fmt.Sprintf("%v\nWindows/Linux-Paket: ffmpeg gehört in denselben Ordner wie p5converter. Bitte neu installieren.", err))
	}
	rs := existingRoots(*roots)
	srv := server.New(version.Get(), tools, rs, *jobsN, cfgDir)
	if desktop {
		srv.Quit = func() { time.Sleep(300 * time.Millisecond); os.Exit(0) }
	}

	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		// Port busy: if it is another p5converter, just bring up its window instead of failing.
		if running(*addr) {
			log.Printf("p5converter läuft bereits auf %s – öffne das Fenster.", *addr)
			if !*noBrowser && !bringToFront() {
				openWindow(urlFor(*addr))
			}
			return
		}
		host, _, _ := net.SplitHostPort(*addr)
		log.Printf("Port %s belegt (%v) – wähle freien Port.", *addr, err)
		ln, err = net.Listen("tcp", net.JoinHostPort(host, "0"))
		if err != nil {
			fatal(desktop, "Kein Netzwerk-Port verfügbar: "+err.Error())
		}
	}
	url := urlFor(ln.Addr().String())
	log.Printf("p5converter %s – %s", version.Get().Version, tools.Version())
	if cfgDir == "" {
		log.Printf("Erlaubte Ordner: %s · Konfiguration: nicht dauerhaft", strings.Join(rs, ", "))
	} else {
		log.Printf("Erlaubte Ordner: %s · Konfiguration: %s", strings.Join(rs, ", "), cfgDir)
	}
	log.Printf("Oberfläche: %s", url)
	go func() {
		if err := http.Serve(ln, srv.Handler()); err != nil {
			fatal(desktop, err.Error())
		}
	}()
	if !*noBrowser {
		// Windows: eigenes App-Fenster (WebView2); endet das Programm, wenn das Fenster geschlossen wird.
		if desktopWindow(url) {
			os.Exit(0)
		}
		time.Sleep(400 * time.Millisecond)
		openWindow(url)
	}
	select {} // der Server läuft im Hintergrund weiter
}

func urlFor(addr string) string {
	h, p, _ := net.SplitHostPort(addr)
	if h == "" || h == "0.0.0.0" || h == "::" || h == "[::]" {
		h = "localhost"
	}
	return "http://" + net.JoinHostPort(h, p)
}

// running reports whether a p5converter instance answers on addr.
func running(addr string) bool {
	c := http.Client{Timeout: 1500 * time.Millisecond}
	resp, err := c.Get(urlFor(addr) + "/api/info")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	var v struct {
		Version string `json:"version"`
	}
	return json.NewDecoder(resp.Body).Decode(&v) == nil && v.Version != ""
}

// setupLog also writes to a log file in desktop mode so errors survive a closed terminal.
func setupLog(desktop bool) {
	log.SetFlags(log.Ldate | log.Ltime)
	if !desktop {
		return
	}
	dir, err := os.UserCacheDir()
	if err != nil {
		return
	}
	dir = filepath.Join(dir, "p5converter")
	if os.MkdirAll(dir, 0o755) != nil {
		return
	}
	path := filepath.Join(dir, "p5converter.log")
	if st, err := os.Stat(path); err == nil && st.Size() > 512*1024 {
		os.Remove(path)
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return
	}
	log.SetOutput(io.MultiWriter(f, stderrWriter{})) // Datei zuerst: ein Windows-Programm ohne Konsole hat keinen gültigen stderr
	log.Printf("Logdatei: %s", f.Name())
}

// stderrWriter schreibt nach stderr und ignoriert Fehler (ohne Konsole ist stderr ungültig) – sonst bräche MultiWriter ab.
type stderrWriter struct{}

func (stderrWriter) Write(p []byte) (int, error) { os.Stderr.Write(p); return len(p), nil }

// fatal logs and, on desktops without a terminal, shows a visible message.
func fatal(desktop bool, msg string) {
	log.Print("FEHLER: " + msg)
	if desktop {
		notify("p5converter konnte nicht starten", msg)
	}
	os.Exit(1)
}

func notify(title, msg string) {
	switch runtime.GOOS {
	case "linux":
		if p, err := exec.LookPath("zenity"); err == nil {
			exec.Command(p, "--error", "--title", title, "--text", msg).Run()
		} else if p, err := exec.LookPath("kdialog"); err == nil {
			exec.Command(p, "--error", msg, "--title", title).Run()
		} else if p, err := exec.LookPath("notify-send"); err == nil {
			exec.Command(p, title, msg).Run()
		}
	case "windows":
		showError(title, msg)
	}
}

// openWindow prefers a chromeless "app window" (Chrome/Chromium/Edge/Brave --app=URL),
// which looks like a normal program; falls back to the default browser.
func openWindow(url string) {
	var cands []string
	switch runtime.GOOS {
	case "windows":
		pf := []string{os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)"), os.Getenv("LocalAppData")}
		for _, base := range pf {
			if base == "" {
				continue
			}
			cands = append(cands,
				filepath.Join(base, `Microsoft\Edge\Application\msedge.exe`),
				filepath.Join(base, `Google\Chrome\Application\chrome.exe`),
				filepath.Join(base, `BraveSoftware\Brave-Browser\Application\brave.exe`))
		}
	case "linux":
		for _, n := range []string{"google-chrome-stable", "google-chrome", "chromium", "chromium-browser", "brave-browser", "microsoft-edge", "microsoft-edge-stable", "vivaldi"} {
			if p, err := exec.LookPath(n); err == nil {
				cands = append(cands, p)
			}
		}
	}
	for _, c := range cands {
		if _, err := os.Stat(c); err != nil {
			continue
		}
		if exec.Command(c, "--app="+url, "--window-size=1280,900").Start() == nil {
			return
		}
	}
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	if err := cmd.Start(); err != nil {
		log.Printf("Browser konnte nicht geöffnet werden (%v). Öffne bitte selbst: %s", err, url)
	}
}

// existingRoots splits a comma-separated root list and drops folders that are not there (optional
// Docker mounts such as /video3 may be left empty). If none exists, the full list is kept so the
// problem stays visible instead of silently opening up everything.
func existingRoots(list string) []string {
	var all, found []string
	for _, r := range strings.Split(list, ",") {
		r = strings.TrimSpace(r)
		if r == "" {
			continue
		}
		all = append(all, r)
		if st, err := os.Stat(r); err == nil && st.IsDir() {
			found = append(found, r)
		} else {
			log.Printf("Ordner %s nicht eingehängt – wird übersprungen.", r)
		}
	}
	if len(found) == 0 {
		return all
	}
	return found
}
