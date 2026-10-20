package server

import (
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestLibraryRowsGroupFoldersOnly(t *testing.T) {
	root := "/lib"
	mk := func(files int, codec string, h int, truehd int) *libAgg {
		a := newAgg()
		a.files, a.bytes, a.dur, a.maxHeight = files, int64(files)*1_000_000, float64(files)*10, h
		a.codecs[codec] = files
		if truehd > 0 {
			a.heavy["truehd"] = truehd
		}
		return a
	}
	direct := map[string]*libAgg{
		"/lib/Serie/S1": mk(3, "h264", 1080, 0), "/lib/Serie/S2": mk(2, "hevc", 1080, 2), "/lib/Film": mk(1, "h264", 720, 0),
	}
	rows := libraryRows(root, direct)
	by := map[string]LibRow{}
	for _, r := range rows {
		by[r.Path+map[bool]string{true: "#g", false: ""}[r.Group]] = r
	}
	if len(rows) != 5 { // S1, S2, Serie (Sammel), Film, Wurzel (Sammel)
		t.Fatalf("5 Zeilen erwartet: %+v", rows)
	}
	s := by["/lib/Serie#g"]
	if !s.Group || s.Folders != 2 || s.Files != 5 || s.Codecs["h264"] != 3 || s.Codecs["hevc"] != 2 || s.Heavy["truehd"] != 2 || s.MaxHeight != 1080 || s.Depth != 1 {
		t.Errorf("Sammelzeile Serie: %+v", s)
	}
	if s.AvgBitrate != 5_000_000*8/50 {
		t.Errorf("Bitrate über Größe und Laufzeit: %d", s.AvgBitrate)
	}
	if f := by["/lib/Film"]; f.Group || f.Folders != 1 || f.Depth != 1 {
		t.Errorf("einzelner Ordner: %+v", f)
	}
	if r := by["/lib#g"]; !r.Group || r.Folders != 3 || r.Depth != 0 || r.Files != 6 {
		t.Errorf("Wurzel: %+v", r)
	}
	// ein einzelner Ordner mit Videos ergibt keine Sammelzeile
	if len(libraryRows("/x", map[string]*libAgg{"/x/a": mk(2, "h264", 480, 0)})) != 1 {
		t.Error("ein Ordner = eine Zeile")
	}
	// nie einzelne Dateien: keine Zeile trägt einen Dateinamen als Pfad
	for _, r := range rows {
		if filepath.Ext(r.Path) != "" {
			t.Errorf("Zeile mit Dateipfad: %s", r.Path)
		}
	}
}

// Echter Scan über die API: Ordner mit mehreren Videos, Staffeln unter einer Serie; Abbruch und Rechte.
func TestLibraryScanAPI(t *testing.T) {
	root := t.TempDir()
	_, ts := newTestServer(t, []string{root})
	mkv := func(rel string) {
		p := filepath.Join(root, rel)
		os.MkdirAll(filepath.Dir(p), 0o755)
		if out, err := exec.Command("ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=160x120:r=10:d=1", "-f", "lavfi", "-i", "sine=f=440:d=1", "-shortest", "-c:v", "libx264", "-c:a", "ac3", p).CombinedOutput(); err != nil {
			t.Fatalf("%v %s", err, out)
		}
	}
	mkv("Serie/Staffel 1/e1.mkv")
	mkv("Serie/Staffel 1/e2.mkv")
	mkv("Serie/Staffel 2/e1.mkv")
	mkv("Film/film.mkv")
	os.WriteFile(filepath.Join(root, "Film", "notiz.txt"), []byte("x"), 0o644)
	resp := post(t, ts, "/api/library/scan", map[string]any{"path": root}, nil)
	var st struct{ ID string }
	json.NewDecoder(resp.Body).Decode(&st)
	resp.Body.Close()
	if st.ID == "" {
		t.Fatalf("keine Auswertung gestartet: %d", resp.StatusCode)
	}
	var got struct {
		State string
		Total int
		Done  int
		Rows  []LibRow
	}
	for i := 0; i < 200; i++ {
		r, _ := http.Get(ts.URL + "/api/library/scan/" + st.ID)
		got.Rows = nil
		json.NewDecoder(r.Body).Decode(&got)
		r.Body.Close()
		if got.State != "running" {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if got.State != "done" || got.Total != 4 || got.Done != 4 {
		t.Fatalf("Zustand %s, %d von %d", got.State, got.Done, got.Total)
	}
	names := map[string]LibRow{}
	for _, r := range got.Rows {
		names[r.Name+map[bool]string{true: "#g", false: ""}[r.Group]] = r
	}
	if names["Staffel 1"].Files != 2 || names["Staffel 2"].Files != 1 || names["Film"].Files != 1 {
		t.Errorf("Ordner: %+v", names)
	}
	if s := names["Serie#g"]; s.Folders != 2 || s.Files != 3 || s.Codecs["h264"] != 3 || s.MaxHeight != 120 {
		t.Errorf("Sammelzeile Serie: %+v", s)
	}
	// außerhalb der erlaubten Ordner und Nicht-Ordner werden abgelehnt
	if r := post(t, ts, "/api/library/scan", map[string]any{"path": "/etc"}, nil); r.StatusCode != 403 {
		t.Errorf("fremder Pfad: %d", r.StatusCode)
	}
	if r := post(t, ts, "/api/library/scan", map[string]any{"path": filepath.Join(root, "Film", "film.mkv")}, nil); r.StatusCode != 400 {
		t.Errorf("Datei statt Ordner: %d", r.StatusCode)
	}
	if r, _ := http.Get(ts.URL + "/api/library/scan/gibtsnicht"); r.StatusCode != 404 {
		t.Error("unbekannte Auswertung")
	}
}
