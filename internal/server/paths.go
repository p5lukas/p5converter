package server

import (
	"context"
	"encoding/json"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

// Pfade: Freigaben prüfen, Ordner und Dateien auflisten, Quellordner untersuchen.

func (s *Server) allowed(p string) bool {
	if len(s.Roots) == 0 {
		return true
	}
	p = resolveExisting(p)
	for _, r := range s.Roots {
		r = resolveExisting(r)
		if p == r || strings.HasPrefix(p, r+string(filepath.Separator)) {
			return true
		}
	}
	return false
}

// resolveExisting löst Symlinks im längsten existierenden Teil von p auf und hängt den Rest wieder an.
// So kann ein Symlink innerhalb eines erlaubten Ordners die Freigabe nicht nach außen verlängern;
// noch nicht angelegte Zielordner (/output/neu/folge) bleiben prüfbar.
func resolveExisting(p string) string {
	p = filepath.Clean(p)
	var rest []string
	for cur := p; ; {
		if real, err := filepath.EvalSymlinks(cur); err == nil {
			for i := len(rest) - 1; i >= 0; i-- {
				real = filepath.Join(real, rest[i])
			}
			return real
		}
		parent := filepath.Dir(cur)
		if parent == cur {
			return p
		}
		rest = append(rest, filepath.Base(cur))
		cur = parent
	}
}

// rootOf liefert den Quellordner (Wurzel), unter dem p liegt; ohne Wurzeln (Desktop-App) oder außerhalb: "".
func (s *Server) rootOf(p string) string {
	p = filepath.Clean(p)
	best := ""
	for _, r := range s.Roots {
		r = filepath.Clean(r)
		if (p == r || strings.HasPrefix(p, r+string(filepath.Separator))) && len(r) > len(best) {
			best = r
		}
	}
	return best
}

// relFrom: Pfad des Ziels bei „Struktur beibehalten“, ab dem Quellordner (Wurzel) gerechnet; ohne Wurzel ab dem Elternordner der gewählten Auswahl.
func (s *Server) relFrom(fp, picked string) string {
	if root := s.rootOf(fp); root != "" {
		if rel, err := filepath.Rel(root, fp); err == nil {
			return filepath.ToSlash(rel)
		}
	}
	rel, _ := filepath.Rel(filepath.Dir(picked), fp)
	return filepath.ToSlash(rel)
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
			files = append(files, scanFile{p, s.relFrom(p, p), st.Size()})
			continue
		}
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
				var size int64
				if inf, err := d.Info(); err == nil {
					size = inf.Size()
				}
				files = append(files, scanFile{fp, s.relFrom(fp, p), size})
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
