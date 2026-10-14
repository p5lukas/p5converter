package main

import (
	"crypto/subtle"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
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
	addr := flag.String("listen", env("P5_LISTEN", "127.0.0.1:8484"), "Adresse:Port (Docker: 0.0.0.0:8484)")
	roots := flag.String("roots", env("P5_ROOTS", ""), "erlaubte Wurzelordner, kommagetrennt (leer = alles erlaubt)")
	ffdir := flag.String("ffmpeg-dir", env("P5_FFMPEG_DIR", ""), "Ordner mit ffmpeg/ffprobe")
	noBrowser := flag.Bool("no-browser", env("P5_NO_BROWSER", "") != "", "Browser nicht automatisch öffnen")
	conc, _ := strconv.Atoi(env("P5_JOBS", "1"))
	jobsN := flag.Int("jobs", conc, "parallele Konvertierungen")
	showVersion := flag.Bool("version", false, "Version anzeigen")
	flag.Parse()
	if *showVersion {
		fmt.Println("p5converter", version)
		return
	}

	tools, err := ffmpeg.Locate(*ffdir)
	if err != nil {
		log.Fatalf("Fehler: %v\nWindows: ffmpeg.exe + ffprobe.exe neben p5converter.exe legen. Fedora: sudo dnf install ffmpeg (RPM Fusion).", err)
	}
	var rs []string
	for _, r := range strings.Split(*roots, ",") {
		if r = strings.TrimSpace(r); r != "" {
			rs = append(rs, r)
		}
	}
	srv := server.New(version, tools, rs, *jobsN)

	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		log.Fatal(err)
	}
	url := "http://" + ln.Addr().String()
	if h, p, _ := net.SplitHostPort(ln.Addr().String()); h == "0.0.0.0" || h == "::" {
		url = "http://localhost:" + p
	}
	log.Printf("p5converter %s – %s", version, tools.Version())
	log.Printf("Oberfläche: %s  (Beenden mit Strg+C)", url)
	if !*noBrowser {
		go func() { time.Sleep(400 * time.Millisecond); openBrowser(url) }()
	}
	h := srv.Handler()
	if pw := os.Getenv("P5_PASSWORD"); pw != "" {
		h = basicAuth(h, pw)
	}
	log.Fatal(http.Serve(ln, h))
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
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
