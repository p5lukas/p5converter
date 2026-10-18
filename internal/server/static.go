package server

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"
)

type asset struct {
	data, gz    []byte
	etag, ctype string
}

// staticHandler serves the embedded UI files with an ETag (304 when unchanged) and, for text files, gzip –
// embed.FS has no modification times, so http.FileServer could never answer 304 and always sent everything.
func staticHandler(fsys fs.FS) (http.Handler, error) {
	assets := map[string]*asset{}
	err := fs.WalkDir(fsys, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		b, err := fs.ReadFile(fsys, p)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(b)
		a := &asset{data: b, etag: `"` + hex.EncodeToString(sum[:8]) + `"`}
		a.ctype = mime.TypeByExtension(path.Ext(p))
		if a.ctype == "" {
			a.ctype = http.DetectContentType(b)
		}
		if strings.HasPrefix(a.ctype, "text/") || strings.Contains(a.ctype, "javascript") {
			var buf bytes.Buffer
			zw, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
			zw.Write(b)
			zw.Close()
			if buf.Len() < len(b) {
				a.gz = buf.Bytes()
			}
		}
		assets[p] = a
		return nil
	})
	if err != nil {
		return nil, err
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		a := assets[strings.TrimPrefix(path.Clean(r.URL.Path), "/")]
		if a == nil || (r.Method != http.MethodGet && r.Method != http.MethodHead) {
			http.NotFound(w, r)
			return
		}
		h := w.Header()
		h.Set("Cache-Control", "no-cache") // always revalidate: new versions show up immediately, unchanged ones cost a 304
		h.Set("ETag", a.etag)
		h.Set("Vary", "Accept-Encoding")
		if m := r.Header.Get("If-None-Match"); m != "" && strings.Contains(m, a.etag) {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		h.Set("Content-Type", a.ctype)
		body := a.data
		if a.gz != nil && strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			h.Set("Content-Encoding", "gzip")
			body = a.gz
		}
		h.Set("Content-Length", strconv.Itoa(len(body)))
		if r.Method == http.MethodGet {
			w.Write(body)
		}
	}), nil
}
