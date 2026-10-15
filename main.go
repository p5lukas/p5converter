package main

import (
	"crypto/subtle"
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

	"github.com/p5lukas/p5converter/internal/ffmpeg"
	"github.com/p5lukas/p5converter/internal/server"
)

var version = "dev"

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func main() {
	addr := flag.String("listen", env("P5_LISTEN", "127.0.0.1:8787"), "Adresse:Port (Docker: 0.0.0.0:8787)")
	roots := flag.String("roots", env("P5_ROOTS", ""), "erlaubte Wurzelordner, kommagetrennt (leer = alles erlaubt)")
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
		fmt.Println("p5converter", version)
		return
	}

	// Desktop mode = started by a person on their own machine (not Docker/server with fixed roots).
	desktop := strings.TrimSpace(*roots) == "" && !*noBrowser
	setupLog(desktop)

	tools, err := ffmpeg.Locate(*ffdir)
	if err != nil {
		fatal(desktop, fmt.Sprintf("%v\nWindows/Linux-Paket: ffmpeg gehört in denselben Ordner wie p5converter. Bitte neu installieren.", err))
	}
	var rs []string
	for _, r := range strings.Split(*roots, ",") {
		if r = strings.TrimSpace(r); r != "" {
			rs = append(rs, r)
		}
	}
	srv := server.New(version, tools, rs, *jobsN)
	if desktop {
		srv.Quit = func() { time.Sleep(300 * time.Millisecond); os.Exit(0) }
	}

	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		// Port busy: if it is another p5converter, just bring up its window instead of failing.
		if running(*addr) {
			log.Printf("p5converter läuft bereits auf %s – öffne das Fenster.", *addr)
			if !*noBrowser {
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
	log.Printf("p5converter %s – %s", version, tools.Version())
	log.Printf("Oberfläche: %s", url)
	if !*noBrowser {
		go func() { time.Sleep(400 * time.Millisecond); openWindow(url) }()
	}
	h := srv.Handler()
	if pw := os.Getenv("P5_PASSWORD"); pw != "" {
		h = basicAuth(h, pw)
	}
	if err := http.Serve(ln, h); err != nil {
		fatal(desktop, err.Error())
	}
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
	log.SetOutput(io.MultiWriter(os.Stderr, f))
	log.Printf("Logdatei: %s", f.Name())
}

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
		exec.Command("powershell", "-NoProfile", "-Command",
			"Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('"+strings.ReplaceAll(msg, "'", "''")+"','"+title+"')").Run()
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

// basicAuth protects the UI when P5_PASSWORD is set (user name: p5).
func basicAuth(next http.Handler, password string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, p, ok := r.BasicAuth()
		if !ok || u != "p5" || subtle.ConstantTimeCompare([]byte(p), []byte(password)) != 1 {
			w.Header().Set("WWW-Authenticate", `Basic realm="p5converter"`)
			http.Error(w, "Login erforderlich", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}
