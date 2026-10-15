package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/p5lukas/p5converter/internal/ffmpeg"
	"github.com/p5lukas/p5converter/internal/rename"
)

const maxRenameItems = 2000

type renameReq struct {
	Items   []string      `json:"items"`
	Pattern string        `json:"pattern"`
	Replace []rename.Rule `json:"replace"`
	Suffix  string        `json:"suffix"`
	// Preview for the converter: file extension and what will be produced.
	Ext    string        `json:"ext"`
	Target rename.Target `json:"target"`
	Mode   string        `json:"mode"` // convert (preview only) | rename (stand-alone tool)
}

type renameRes struct {
	Path  string `json:"path"`
	Old   string `json:"old"`
	New   string `json:"new"`
	Error string `json:"error,omitempty"`
	Done  bool   `json:"done,omitempty"`
}

// planRename computes the new names. rename mode: same folder, extension kept, no sub folders.
func (s *Server) planRename(ctx context.Context, rq *renameReq) ([]renameRes, error) {
	if len(rq.Items) > maxRenameItems {
		return nil, fmt.Errorf("zu viele Dateien (höchstens %d)", maxRenameItems)
	}
	if err := rename.Validate(rq.Replace); err != nil {
		return nil, err
	}
	needInfo := strings.Contains(rq.Pattern, "{")
	out := make([]renameRes, 0, len(rq.Items))
	seen := map[string]int{}
	for _, p := range rq.Items {
		p = filepath.Clean(p)
		r := renameRes{Path: p, Old: filepath.Base(p)}
		if !s.allowed(p) || (len(s.Roots) > 0 && !s.allowed(filepath.Dir(p))) {
			r.Error = "Pfad nicht erlaubt"
			out = append(out, r)
			continue
		}
		info := &ffmpeg.Info{Tags: map[string]string{}}
		if needInfo {
			pctx, cancel := context.WithTimeout(ctx, 20*time.Second)
			if i, err := s.Tools.Probe(pctx, p); err == nil {
				info = i
			}
			cancel()
		}
		ext := filepath.Ext(p)
		t := rq.Target
		if rq.Mode == "rename" {
			t = rename.Target{Container: strings.TrimPrefix(ext, ".")}
		} else {
			ext = "." + strings.TrimPrefix(rq.Ext, ".")
			if rq.Ext == "" {
				ext = filepath.Ext(p)
			}
		}
		pat := rq.Pattern
		nn, err := rename.NewName(pat, rq.Replace, rq.Suffix, info, p, t)
		if err != nil {
			r.Error = err.Error()
			out = append(out, r)
			continue
		}
		if rq.Mode == "rename" {
			nn = strings.ReplaceAll(nn, "/", "_") // the tool only renames, never moves
		}
		r.New = nn + ext
		if rq.Mode == "rename" {
			key := filepath.Join(filepath.Dir(p), strings.ToLower(r.New))
			if j, dup := seen[key]; dup && j >= 0 {
				r.Error = "doppelter neuer Name"
			}
			seen[key] = len(out)
			if r.New != r.Old {
				if _, err := os.Lstat(filepath.Join(filepath.Dir(p), r.New)); err == nil && !strings.EqualFold(r.New, r.Old) {
					r.Error = "Datei existiert bereits"
				}
			}
		}
		out = append(out, r)
	}
	return out, nil
}

func (s *Server) renamePreview(w http.ResponseWriter, r *http.Request) {
	var rq renameReq
	if err := json.NewDecoder(r.Body).Decode(&rq); err != nil {
		httpErr(w, 400, err.Error())
		return
	}
	res, err := s.planRename(r.Context(), &rq)
	if err != nil {
		httpErr(w, 400, err.Error())
		return
	}
	writeJSON(w, map[string]any{"items": res})
}

func (s *Server) renameApply(w http.ResponseWriter, r *http.Request) {
	var rq renameReq
	if err := json.NewDecoder(r.Body).Decode(&rq); err != nil {
		httpErr(w, 400, err.Error())
		return
	}
	rq.Mode = "rename"
	res, err := s.planRename(r.Context(), &rq)
	if err != nil {
		httpErr(w, 400, err.Error())
		return
	}
	ok, failed := 0, 0
	for i := range res {
		x := &res[i]
		if x.Error != "" {
			failed++
			continue
		}
		if x.New == x.Old {
			continue
		}
		if err := os.Rename(x.Path, filepath.Join(filepath.Dir(x.Path), x.New)); err != nil {
			x.Error = err.Error()
			failed++
			continue
		}
		x.Done = true
		ok++
	}
	writeJSON(w, map[string]any{"items": res, "renamed": ok, "failed": failed})
}
