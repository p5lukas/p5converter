package server

// Bibliothek-Scan („Was lohnt sich?“): ein Ordner wird rekursiv gelesen (ffprobe, wenige Dateien gleichzeitig) und ORDNERWEISE zusammengefasst.
// Es werden nie einzelne Dateien vorgeschlagen und nichts geschätzt: die Zeilen enthalten nur Fakten (Dateien, Größe, Codec-Mix, Bitrate, schwere
// Tonformate, Bild-Untertitel); was davon „lohnend“ aussieht, entscheidet die Oberfläche anhand dieser Fakten.

import (
	"context"
	"encoding/json"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/p5lukas/p5converter/internal/ffmpeg"
)

// LibRow: eine Zeile der Ergebnisliste = ein Ordner (oder ein Sammelordner über mehrere Ordner mit Videos).
type LibRow struct {
	Path       string         `json:"path"`
	Name       string         `json:"name"`
	Depth      int            `json:"depth"`   // Ebene unterhalb des geprüften Ordners (0 = er selbst)
	Group      bool           `json:"group"`   // Sammelordner: fasst mehrere Ordner mit Videos darunter zusammen (z. B. eine ganze Serie)
	Folders    int            `json:"folders"` // Zahl der Ordner mit Videos (bei Sammelordnern > 1)
	Files      int            `json:"files"`
	Bytes      int64          `json:"bytes"`
	AvgBitrate int64          `json:"avgBitrate"` // Bit/s über Größe und Laufzeit (gesamte Datei, mit Ton)
	Codecs     map[string]int `json:"codecs"`     // Video-Codec → Zahl der Dateien
	MaxHeight  int            `json:"maxHeight"`
	Heavy      map[string]int `json:"heavy"` // schwere Tonformate: dts, dtshd, truehd → Zahl der Dateien
	ImageSubs  int            `json:"imageSubs"`
	Unreadable int            `json:"unreadable"`
}

type libAgg struct {
	files, imageSubs, unreadable, maxHeight, leaves int
	bytes                                           int64
	dur                                             float64
	codecs, heavy                                   map[string]int
}

func newAgg() *libAgg { return &libAgg{codecs: map[string]int{}, heavy: map[string]int{}} }

func (a *libAgg) add(b *libAgg) {
	a.files += b.files
	a.imageSubs += b.imageSubs
	a.unreadable += b.unreadable
	a.bytes += b.bytes
	a.dur += b.dur
	a.leaves += b.leaves
	if b.maxHeight > a.maxHeight {
		a.maxHeight = b.maxHeight
	}
	for k, v := range b.codecs {
		a.codecs[k] += v
	}
	for k, v := range b.heavy {
		a.heavy[k] += v
	}
}

func (a *libAgg) row(root, dir string, group bool) LibRow {
	rel, _ := filepath.Rel(root, dir)
	depth := 0
	if rel != "." {
		depth = len(strings.Split(filepath.ToSlash(rel), "/"))
	}
	r := LibRow{Path: dir, Name: filepath.Base(dir), Depth: depth, Group: group, Folders: a.leaves, Files: a.files, Bytes: a.bytes, Codecs: a.codecs,
		MaxHeight: a.maxHeight, Heavy: a.heavy, ImageSubs: a.imageSubs, Unreadable: a.unreadable}
	if a.dur > 0 {
		r.AvgBitrate = int64(float64(a.bytes) * 8 / a.dur)
	}
	return r
}

// libraryRows fasst die Auswertung je Ordner zusammen: eine Zeile je Ordner mit Videos, dazu Sammelzeilen für Ordner darüber,
// die mindestens zwei solcher Ordner enthalten (z. B. eine Serie mit mehreren Staffeln).
func libraryRows(root string, direct map[string]*libAgg) []LibRow {
	total := map[string]*libAgg{}
	leaves := map[string]int{}
	for dir, a := range direct {
		a.leaves = 1
		for d := dir; ; d = filepath.Dir(d) {
			t := total[d]
			if t == nil {
				t = newAgg()
				total[d] = t
			}
			t.add(a)
			leaves[d]++
			if d == root || filepath.Dir(d) == d {
				break
			}
		}
	}
	var rows []LibRow
	for dir, t := range total {
		_, isLeaf := direct[dir]
		switch {
		case isLeaf && leaves[dir] == 1:
			rows = append(rows, direct[dir].row(root, dir, false))
		case leaves[dir] >= 2: // Ordner über mehreren Ordnern mit Videos (auch wenn er selbst Videos enthält): eine Sammelzeile über alles darunter
			rows = append(rows, t.row(root, dir, true))
		}
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Path != rows[j].Path {
			return rows[i].Path < rows[j].Path
		}
		return rows[i].Group && !rows[j].Group
	})
	return rows
}

type libScan struct {
	mu      sync.Mutex
	ID      string
	root    string
	state   string // running | done | canceled | error
	total   int
	done    int
	cached  int // davon aus dem Merker (nicht neu gelesen)
	current string
	err     string
	rows    []LibRow
	cancel  context.CancelFunc
	started time.Time
}

type libraryScans struct {
	mu    sync.Mutex
	seq   int
	scans map[string]*libScan
}

const libMaxFiles = 20000

func (s *Server) libraryStart(w http.ResponseWriter, r *http.Request) {
	var b struct{ Path string }
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&b) != nil || b.Path == "" {
		httpErr(w, 400, "Pfad fehlt")
		return
	}
	root := filepath.Clean(b.Path)
	if !s.allowed(root) {
		httpErr(w, 403, "Pfad nicht erlaubt")
		return
	}
	if st, err := os.Stat(root); err != nil || !st.IsDir() {
		httpErr(w, 400, "Das ist kein Ordner")
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.lib.mu.Lock()
	if s.lib.scans == nil {
		s.lib.scans = map[string]*libScan{}
	}
	s.lib.seq++
	sc := &libScan{ID: "l" + strconv.Itoa(s.lib.seq), root: root, state: "running", cancel: cancel, started: time.Now()}
	s.lib.scans[sc.ID] = sc
	for id, o := range s.lib.scans { // höchstens fünf Auswertungen behalten
		if len(s.lib.scans) > 5 && o.state != "running" && id != sc.ID {
			delete(s.lib.scans, id)
		}
	}
	s.lib.mu.Unlock()
	go s.libraryRun(ctx, sc)
	writeJSON(w, map[string]string{"id": sc.ID})
}

func (s *Server) libraryRun(ctx context.Context, sc *libScan) {
	defer sc.cancel()
	var files []string
	var sizes, mtimes = map[string]int64{}, map[string]int64{}
	filepath.WalkDir(sc.root, func(fp string, d fs.DirEntry, err error) error {
		if err != nil || ctx.Err() != nil || len(files) >= libMaxFiles {
			return nil
		}
		if d.IsDir() {
			if strings.HasPrefix(d.Name(), ".") && fp != sc.root {
				return filepath.SkipDir
			}
			return nil
		}
		if mediaKind(d.Name()) == "video" {
			files = append(files, fp)
			if inf, err := d.Info(); err == nil {
				sizes[fp], mtimes[fp] = inf.Size(), inf.ModTime().UnixNano()
			}
		}
		return nil
	})
	sc.mu.Lock()
	sc.total = len(files)
	sc.mu.Unlock()
	direct := map[string]*libAgg{}
	var dmu sync.Mutex
	next := make(chan string)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ { // wenige Dateien gleichzeitig: der Server soll dabei nicht ins Schwitzen kommen
		wg.Add(1)
		go func() {
			defer wg.Done()
			for fp := range next {
				facts, ok := s.libCache.get(fp, sizes[fp], mtimes[fp])
				var info *ffmpeg.Info
				var err error
				if !ok {
					pctx, cancel := context.WithTimeout(ctx, 30*time.Second)
					info, err = s.Tools.Probe(pctx, fp)
					cancel()
					if err == nil && info != nil {
						facts = factsOf(info)
						facts.Size, facts.Mtime = sizes[fp], mtimes[fp]
						if ctx.Err() == nil {
							s.libCache.put(fp, facts)
						}
					}
				}
				dir := filepath.Dir(fp)
				dmu.Lock()
				a := direct[dir]
				if a == nil {
					a = newAgg()
					direct[dir] = a
				}
				a.files++
				a.bytes += sizes[fp]
				if !ok && (err != nil || info == nil) {
					a.unreadable++
				} else {
					a.addFacts(facts)
				}
				if ok {
					sc.mu.Lock()
					sc.cached++
					sc.mu.Unlock()
				}
				dmu.Unlock()
				sc.mu.Lock()
				sc.done++
				sc.current = fp
				sc.mu.Unlock()
			}
		}()
	}
loop:
	for _, fp := range files {
		select {
		case next <- fp:
		case <-ctx.Done():
			break loop
		}
	}
	close(next)
	wg.Wait()
	seen := make(map[string]bool, len(files))
	for _, fp := range files {
		seen[fp] = true
	}
	if ctx.Err() == nil {
		s.libCache.finish(sc.root, seen)
	}
	rows := libraryRows(sc.root, direct)
	sc.mu.Lock()
	sc.rows = rows
	if ctx.Err() != nil {
		sc.state = "canceled"
	} else {
		sc.state = "done"
	}
	sc.current = ""
	sc.mu.Unlock()
}

func (s *Server) libraryGet(w http.ResponseWriter, r *http.Request) {
	s.lib.mu.Lock()
	sc := s.lib.scans[r.PathValue("id")]
	s.lib.mu.Unlock()
	if sc == nil {
		httpErr(w, 404, "Unbekannte Auswertung")
		return
	}
	sc.mu.Lock()
	defer sc.mu.Unlock()
	out := map[string]any{"id": sc.ID, "root": sc.root, "state": sc.state, "total": sc.total, "done": sc.done, "cached": sc.cached, "current": sc.current, "error": sc.err}
	if sc.state != "running" {
		out["rows"] = sc.rows
	}
	writeJSON(w, out)
}

func (s *Server) libraryCancel(w http.ResponseWriter, r *http.Request) {
	s.lib.mu.Lock()
	sc := s.lib.scans[r.PathValue("id")]
	s.lib.mu.Unlock()
	if sc != nil {
		sc.cancel()
	}
	writeJSON(w, map[string]bool{"ok": true})
}
