package server

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// „Struktur beibehalten“ rechnet ab dem Quellordner (Wurzel), egal in welchem Unterordner ausgewählt wurde.
func TestScanRelFromRoot(t *testing.T) {
	root := t.TempDir()
	season := filepath.Join(root, "The Lost Room (2006) {tvdb-79637}", "Season 01")
	if err := os.MkdirAll(season, 0o755); err != nil {
		t.Fatal(err)
	}
	f1, f2 := filepath.Join(season, "e01.mkv"), filepath.Join(season, "e02.mkv")
	for _, f := range []string{f1, f2} {
		os.WriteFile(f, []byte("x"), 0o644)
	}
	_, ts := newTestServer(t, []string{root})
	scan := func(paths ...string) []string {
		resp := post(t, ts, "/api/scan", map[string]any{"paths": paths, "kind": "video"}, map[string]string{"Origin": ts.URL})
		defer resp.Body.Close()
		var out struct {
			Files []scanFile `json:"files"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
			t.Fatal(err)
		}
		var rels []string
		for _, f := range out.Files {
			rels = append(rels, f.Rel)
		}
		return rels
	}
	want := []string{"The Lost Room (2006) {tvdb-79637}/Season 01/e01.mkv", "The Lost Room (2006) {tvdb-79637}/Season 01/e02.mkv"}
	for name, got := range map[string][]string{
		"einzelne Dateien": scan(f1, f2),
		"Ordner Season 01": scan(season),
		"Serienordner":     scan(filepath.Dir(season)),
		"Wurzel selbst":    scan(root),
	} {
		if len(got) != 2 || got[0] != want[0] || got[1] != want[1] {
			t.Errorf("%s: %v, erwartet %v", name, got, want)
		}
	}
}

// Ohne Wurzeln (Desktop-App) bleibt es beim Elternordner der Auswahl.
func TestScanRelWithoutRoots(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "Serie", "Season 01")
	os.MkdirAll(dir, 0o755)
	os.WriteFile(filepath.Join(dir, "e01.mkv"), []byte("x"), 0o644)
	s, _ := newTestServer(t, nil)
	if got := s.relFrom(filepath.Join(dir, "e01.mkv"), dir); got != "Season 01/e01.mkv" {
		t.Errorf("Ordner: %q", got)
	}
	if got := s.relFrom(filepath.Join(dir, "e01.mkv"), filepath.Join(dir, "e01.mkv")); got != "e01.mkv" {
		t.Errorf("Datei: %q", got)
	}
}
