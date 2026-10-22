package server

import (
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode"
)

// limits of the folder search (a search must never freeze the server on a huge share)
const (
	searchMaxResults = 300
	searchMaxVisited = 40000
	searchMaxDepth   = 10
)

type fsHit struct {
	Name  string `json:"name"` // path relative to the folder searched in, with "/"
	Path  string `json:"path"` // full path
	Dir   bool   `json:"dir"`
	Size  int64  `json:"size,omitempty"`
	Media string `json:"media,omitempty"`
}

// fold makes the search forgiving: upper/lower case does not matter and umlauts can be typed either way
// (a: "muller" and "mueller" both find "Müller"; ß = ss). foldU maps ü → u, foldE maps ü → ue.
var (
	foldU = strings.NewReplacer("ä", "a", "ö", "o", "ü", "u", "ß", "ss", "Ä", "a", "Ö", "o", "Ü", "u")
	foldE = strings.NewReplacer("ä", "ae", "ö", "oe", "ü", "ue", "ß", "ss", "Ä", "ae", "Ö", "oe", "Ü", "ue")
)

func lower(s string) string { return strings.Map(unicode.ToLower, s) }
func fold(s string) string  { return lower(foldU.Replace(s)) }

// matches: name contains the query, ignoring case; the umlaut spelling may differ either way
func matches(name, q string) bool {
	return strings.Contains(lower(foldU.Replace(name)), lower(foldU.Replace(q))) || strings.Contains(lower(foldE.Replace(name)), lower(foldE.Replace(q)))
}

// browseSearch looks for folders and media files whose name contains q – below path (empty = all allowed roots).
// dirs=1 only lists folders (for choosing a target folder). Hidden entries are skipped, symlinks are not followed.
func (s *Server) browseSearch(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len([]rune(q)) < 2 {
		httpErr(w, 400, "Bitte mindestens 2 Zeichen suchen")
		return
	}
	onlyDirs := r.URL.Query().Get("dirs") == "1"
	var starts []string
	if p := r.URL.Query().Get("path"); p != "" {
		starts = []string{filepath.Clean(p)}
	} else if len(s.Roots) > 0 {
		starts = s.Roots
	} else {
		home, _ := os.UserHomeDir()
		starts = []string{home}
	}
	var hits []fsHit
	visited, truncated := 0, false
	for _, root := range starts {
		root = filepath.Clean(root)
		if !s.allowed(root) {
			httpErr(w, 403, "Pfad nicht erlaubt")
			return
		}
		filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
			if r.Context().Err() != nil {
				return filepath.SkipAll
			}
			if err != nil {
				if d != nil && d.IsDir() {
					return filepath.SkipDir // unreadable folder
				}
				return nil
			}
			if p == root {
				return nil
			}
			if visited++; visited > searchMaxVisited {
				truncated = true
				return filepath.SkipAll
			}
			name := d.Name()
			if strings.HasPrefix(name, ".") {
				if d.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			rel, _ := filepath.Rel(root, p)
			if d.IsDir() && strings.Count(rel, string(filepath.Separator)) >= searchMaxDepth {
				return filepath.SkipDir
			}
			if !matches(name, q) {
				return nil
			}
			h := fsHit{Name: filepath.ToSlash(rel), Path: p, Dir: d.IsDir()}
			if len(starts) > 1 {
				h.Name = filepath.ToSlash(filepath.Join(filepath.Base(root), rel)) // several roots: say which one
			}
			if !d.IsDir() {
				k := mediaKind(name)
				if k == "" || onlyDirs {
					return nil
				}
				h.Media = k
				if inf, err := d.Info(); err == nil {
					h.Size = inf.Size()
				}
			}
			if hits = append(hits, h); len(hits) >= searchMaxResults {
				truncated = true
				return filepath.SkipAll
			}
			return nil
		})
		if truncated {
			break
		}
	}
	sort.Slice(hits, func(i, j int) bool {
		if hits[i].Dir != hits[j].Dir {
			return hits[i].Dir
		}
		return fold(hits[i].Name) < fold(hits[j].Name)
	})
	writeJSON(w, map[string]any{"hits": hits, "truncated": truncated})
}
