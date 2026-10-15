// Package logs is the application log: a rotating file in <config>/logs (plus console and an in-memory ring),
// secrets are redacted, and the read API used by the log page. Format as in p5assets:
//
//	[2026-10-15 12:00:00] [INFO] jobs | Auftrag j1 gestartet
package logs

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	Name        = "p5converter.log"
	maxFileSize = 2_000_000
	backups     = 3
	ringLines   = 3000
)

type Level int

const (
	Debug Level = iota
	Info
	Warning
	Error
)

var levelNames = [...]string{"DEBUG", "INFO", "WARNING", "ERROR"}

// Entry is one parsed log line (continuation lines are merged into the message).
type Entry struct {
	TS    string `json:"ts"`
	Level string `json:"level"`
	Src   string `json:"src"`
	Msg   string `json:"msg"`
}

var (
	mu      sync.Mutex
	dir     string // <config>/logs, "" = memory only
	file    *os.File
	size    int64
	ring    []string
	lineSeq int64 // number of lines ever written (offset in memory mode)
	// alerts: warnings/errors since start (sequence number, isError)
	alertSeq int64
	alertEv  []alertEvent
	console  io.Writer = os.Stdout
)

type alertEvent struct {
	seq     int64
	isError bool
}

var (
	lineRe  = regexp.MustCompile(`^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] \[([A-Z]+)\] ([^|]*?) \| (.*)$`)
	fileOK  = regexp.MustCompile(`^p5converter\.log(\.\d+)?$`)
	secrets = []*regexp.Regexp{
		regexp.MustCompile(`(?i)(passwor[dt]|pwd|api[_-]?key|token)(["']?\s*[:=]\s*["']?)[^\s&"',;]+`),
		regexp.MustCompile(`(p5c_session=)[^\s;]+`),
		regexp.MustCompile(`(?i)(authorization:\s*\w+\s+)\S+`),
	}
)

// Redact removes passwords, session cookies and tokens from a message.
func Redact(s string) string {
	s = secrets[0].ReplaceAllString(s, "${1}${2}***")
	s = secrets[1].ReplaceAllString(s, "${1}***")
	s = secrets[2].ReplaceAllString(s, "${1}***")
	return s
}

// Setup opens <configDir>/logs/p5converter.log (configDir == "": memory only).
func Setup(configDir string) {
	mu.Lock()
	defer mu.Unlock()
	if file != nil {
		file.Close()
		file = nil
	}
	dir = ""
	if configDir == "" {
		return
	}
	d := filepath.Join(configDir, "logs")
	if os.MkdirAll(d, 0o755) != nil {
		return
	}
	f, err := os.OpenFile(filepath.Join(d, Name), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return
	}
	st, _ := f.Stat()
	file, dir = f, d
	if st != nil {
		size = st.Size()
	}
}

// SetConsole changes where the console copy goes (tests use io.Discard).
func SetConsole(w io.Writer) { mu.Lock(); console = w; mu.Unlock() }

// Logger writes entries for one source (e.g. "jobs", "auth", "hw").
type Logger struct{ src string }

func Get(src string) *Logger { return &Logger{src} }

func (l *Logger) Debugf(f string, a ...any) { emit(Debug, l.src, fmt.Sprintf(f, a...)) }
func (l *Logger) Infof(f string, a ...any)  { emit(Info, l.src, fmt.Sprintf(f, a...)) }
func (l *Logger) Warnf(f string, a ...any)  { emit(Warning, l.src, fmt.Sprintf(f, a...)) }
func (l *Logger) Errorf(f string, a ...any) { emit(Error, l.src, fmt.Sprintf(f, a...)) }

func emit(lv Level, src, msg string) {
	msg = Redact(strings.TrimRight(msg, "\r\n"))
	if msg == "" {
		return
	}
	lines := strings.Split(msg, "\n")
	head := fmt.Sprintf("[%s] [%s] %s | %s", time.Now().Format("2006-01-02 15:04:05"), levelNames[lv], src, lines[0])
	out := append([]string{head}, lines[1:]...)
	mu.Lock()
	defer mu.Unlock()
	for _, l := range out {
		ring = append(ring, l)
		lineSeq++
	}
	if len(ring) > ringLines {
		ring = ring[len(ring)-ringLines:]
	}
	text := strings.Join(out, "\n") + "\n"
	if console != nil {
		io.WriteString(console, text)
	}
	if file != nil {
		if size+int64(len(text)) > maxFileSize {
			rotateLocked()
		}
		if file != nil {
			n, _ := file.WriteString(text)
			size += int64(n)
		}
	}
	if lv >= Warning {
		alertSeq++
		alertEv = append(alertEv, alertEvent{alertSeq, lv >= Error})
		if len(alertEv) > 1000 {
			alertEv = alertEv[len(alertEv)-1000:]
		}
	}
}

func rotateLocked() {
	file.Close()
	base := filepath.Join(dir, Name)
	os.Remove(fmt.Sprintf("%s.%d", base, backups))
	for i := backups - 1; i >= 1; i-- {
		os.Rename(fmt.Sprintf("%s.%d", base, i), fmt.Sprintf("%s.%d", base, i+1))
	}
	os.Rename(base, base+".1")
	f, err := os.OpenFile(base, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		file = nil
		return
	}
	file, size = f, 0
}

// Writer lets the standard library logger write into this log ("FEHLER:" lines become errors).
func Writer(src string) io.Writer { return stdWriter{src} }

type stdWriter struct{ src string }

func (w stdWriter) Write(p []byte) (int, error) {
	s := strings.TrimRight(string(p), "\r\n")
	lv := Info
	switch {
	case strings.HasPrefix(s, "FEHLER"):
		lv = Error
	case strings.HasPrefix(s, "Hinweis"):
		lv = Warning
	}
	emit(lv, w.src, s)
	return len(p), nil
}

// ---------------------------------------------------------------- alerts ---

type Alert struct {
	Seq      int64 `json:"seq"`
	Errors   int   `json:"errors"`
	Warnings int   `json:"warnings"`
}

// Alerts counts warnings/errors newer than since (a sequence number the browser remembers).
func Alerts(since int64) Alert {
	mu.Lock()
	defer mu.Unlock()
	if since > alertSeq {
		since = 0 // restarted since the browser looked
	}
	a := Alert{Seq: alertSeq}
	for _, e := range alertEv {
		if e.seq > since {
			if e.isError {
				a.Errors++
			} else {
				a.Warnings++
			}
		}
	}
	return a
}

// -------------------------------------------------------------- read API ---

type FileInfo struct {
	Name  string `json:"name"`
	Size  int64  `json:"size"`
	MTime int64  `json:"mtime"`
}

func Files() []FileInfo {
	mu.Lock()
	defer mu.Unlock()
	var out []FileInfo
	if dir != "" {
		ents, _ := os.ReadDir(dir)
		for _, e := range ents {
			if fileOK.MatchString(e.Name()) {
				if st, err := e.Info(); err == nil {
					out = append(out, FileInfo{e.Name(), st.Size(), st.ModTime().Unix()})
				}
			}
		}
		sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	}
	if len(out) == 0 {
		n := int64(0)
		for _, l := range ring {
			n += int64(len(l)) + 1
		}
		out = []FileInfo{{Name, n, 0}}
	}
	return out
}

// Path returns the file path of a valid log file name.
func Path(name string) (string, error) {
	if !fileOK.MatchString(name) {
		return "", errors.New("Ungültige Logdatei")
	}
	mu.Lock()
	defer mu.Unlock()
	if dir == "" {
		return "", os.ErrNotExist
	}
	return filepath.Join(dir, name), nil
}

func parse(text string) []Entry {
	var out []Entry
	sc := bufio.NewScanner(strings.NewReader(text))
	sc.Buffer(make([]byte, 64*1024), 4*1024*1024)
	for sc.Scan() {
		line := sc.Text()
		if m := lineRe.FindStringSubmatch(line); m != nil {
			out = append(out, Entry{TS: m[1], Level: m[2], Src: strings.TrimSpace(m[3]), Msg: m[4]})
		} else if len(out) > 0 && strings.TrimSpace(line) != "" {
			out[len(out)-1].Msg += "\n" + line
		} else if strings.TrimSpace(line) != "" {
			out = append(out, Entry{Level: "INFO", Msg: line})
		}
	}
	return out
}

type Result struct {
	Entries []Entry `json:"entries"`
	Offset  int64   `json:"offset"`
	Reset   bool    `json:"reset"`
	Total   int     `json:"total"`
	Size    int64   `json:"size"`
}

// Read returns the last tail entries (hasOffset=false) or only what is new since offset (live mode).
func Read(name string, tail int, offset int64, hasOffset bool) (Result, error) {
	if !fileOK.MatchString(name) {
		return Result{}, errors.New("Ungültige Logdatei")
	}
	if tail < 1 {
		tail = 1000
	}
	if tail > 20000 {
		tail = 20000
	}
	mu.Lock()
	if dir == "" { // memory mode: offset = line counter
		defer mu.Unlock()
		if name != Name {
			return Result{Reset: true}, nil
		}
		if hasOffset && offset >= 0 && offset <= lineSeq && lineSeq-offset <= int64(len(ring)) {
			add := ring[len(ring)-int(lineSeq-offset):]
			e := parse(strings.Join(add, "\n"))
			return Result{Entries: e, Offset: lineSeq, Total: len(e)}, nil
		}
		e := parse(strings.Join(ring, "\n"))
		if len(e) > tail {
			e = e[len(e)-tail:]
		}
		return Result{Entries: e, Offset: lineSeq, Reset: true, Total: len(e)}, nil
	}
	p := filepath.Join(dir, name)
	mu.Unlock()
	f, err := os.Open(p)
	if err != nil {
		return Result{Reset: true}, nil
	}
	defer f.Close()
	st, _ := f.Stat()
	sz := st.Size()
	if hasOffset && offset >= 0 && offset <= sz {
		f.Seek(offset, io.SeekStart)
		b, _ := io.ReadAll(f)
		e := parse(string(b))
		return Result{Entries: e, Offset: sz, Total: len(e), Size: sz}, nil
	}
	limit := int64(1_500_000)
	if tail > 5000 {
		limit = 8_000_000
	}
	start := sz - limit
	if start < 0 {
		start = 0
	}
	f.Seek(start, io.SeekStart)
	b, _ := io.ReadAll(f)
	text := string(b)
	if start > 0 {
		if i := strings.IndexByte(text, '\n'); i >= 0 {
			text = text[i+1:]
		}
	}
	e := parse(text)
	total := len(e)
	if len(e) > tail {
		e = e[len(e)-tail:]
	}
	return Result{Entries: e, Offset: sz, Reset: true, Total: total, Size: sz}, nil
}

// Clear empties the current log (the handle stays open) or deletes a rotated one.
func Clear(name string) error {
	if !fileOK.MatchString(name) {
		return errors.New("Ungültige Logdatei")
	}
	mu.Lock()
	defer mu.Unlock()
	if dir == "" {
		if name == Name {
			ring = nil
		}
		return nil
	}
	p := filepath.Join(dir, name)
	if name == Name {
		if file != nil {
			file.Truncate(0)
			file.Seek(0, io.SeekStart)
			size = 0
		}
		ring = nil
		return nil
	}
	return os.Remove(p)
}
