package server

import (
	"encoding/json"
	"github.com/p5lukas/p5converter/internal/ffmpeg"
	"github.com/p5lukas/p5converter/internal/version"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
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

// Merker: ein zweiter Scan liest nichts neu und liefert dieselben Fakten; geänderte Dateien werden neu gelesen, gelöschte vergessen,
// und der Merker übersteht einen Neustart.
func TestLibraryScanCache(t *testing.T) {
	root, cfg := t.TempDir(), t.TempDir()
	tl, err := ffmpeg.Locate("")
	if err != nil {
		t.Skip("ffmpeg nicht installiert")
	}
	mkv := func(rel, codec string) {
		p := filepath.Join(root, rel)
		os.MkdirAll(filepath.Dir(p), 0o755)
		if out, err := exec.Command("ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=160x120:r=10:d=1", "-f", "lavfi", "-i", "sine=f=440:d=1", "-shortest", "-c:v", codec, "-c:a", "ac3", p).CombinedOutput(); err != nil {
			t.Fatalf("%v %s", err, out)
		}
	}
	mkv("Serie/Staffel 1/e1.mkv", "libx264")
	mkv("Serie/Staffel 1/e2.mkv", "libx264")
	mkv("Film/film.mkv", "libx264")
	run := func(s *Server, ts *httptest.Server) (rows []LibRow, total, cached int) {
		resp := post(t, ts, "/api/library/scan", map[string]any{"path": root}, nil)
		var st struct{ ID string }
		json.NewDecoder(resp.Body).Decode(&st)
		resp.Body.Close()
		var got struct {
			State         string
			Total, Cached int
			Rows          []LibRow
		}
		for i := 0; i < 300; i++ {
			r, _ := http.Get(ts.URL + "/api/library/scan/" + st.ID)
			got.Rows = nil
			json.NewDecoder(r.Body).Decode(&got)
			r.Body.Close()
			if got.State != "running" {
				break
			}
			time.Sleep(100 * time.Millisecond)
		}
		if got.State != "done" {
			t.Fatalf("Zustand %s", got.State)
		}
		return got.Rows, got.Total, got.Cached
	}
	s := New(version.Get(), tl, []string{root}, 2, cfg)
	ts := httptest.NewServer(s.Handler())
	defer ts.Close()
	rows1, total, cached := run(s, ts)
	if total != 3 || cached != 0 {
		t.Fatalf("erster Scan: %d Dateien, %d aus dem Merker", total, cached)
	}
	rows2, _, cached := run(s, ts)
	if cached != 3 || !reflect.DeepEqual(rows1, rows2) {
		t.Errorf("zweiter Scan: %d aus dem Merker, gleiche Zeilen: %v\n%+v\n%+v", cached, reflect.DeepEqual(rows1, rows2), rows1, rows2)
	}
	// Neustart: der Merker liegt in /config
	s2 := New(version.Get(), tl, []string{root}, 2, cfg)
	ts2 := httptest.NewServer(s2.Handler())
	defer ts2.Close()
	rows3, _, cached := run(s2, ts2)
	if cached != 3 || !reflect.DeepEqual(rows1, rows3) {
		t.Errorf("nach Neustart: %d aus dem Merker", cached)
	}
	// eine Datei ändert sich (anderer Codec, neue Größe), eine wird gelöscht
	mkv("Serie/Staffel 1/e1.mkv", "mpeg4")
	os.Remove(filepath.Join(root, "Film", "film.mkv"))
	rows4, total, cached := run(s2, ts2)
	if total != 2 || cached != 1 {
		t.Errorf("nach Änderung: %d Dateien, %d aus dem Merker (erwartet 2 und 1)", total, cached)
	}
	for _, r := range rows4 {
		if r.Name == "Staffel 1" && (r.Codecs["mpeg4"] != 1 || r.Codecs["h264"] != 1) {
			t.Errorf("geänderte Datei nicht neu gelesen: %+v", r.Codecs)
		}
	}
	if _, ok := s2.libCache.files[filepath.Join(root, "Film", "film.mkv")]; ok {
		t.Error("gelöschte Datei steht noch im Merker")
	}
}

func TestSourceTag(t *testing.T) {
	for name, want := range map[string]string{
		"Hellsing Ultimate (2006) - S01E01 - Hellsing I [Bluray-1080p][DTS 5.1][x265]-GRP.mkv": "bluray",
		"Show S01E01 [WEBDL-720p][AAC 2.0][h264].mkv":                                          "webdl",
		"Show.S01E01.1080p.WEB-DL.DDP5.1.H.264-GRP.mkv":                                        "webdl",
		"Show.S01E01.720p.WEBRip.x264.mkv":                                                     "webrip",
		"Show S01E01 WEB 720p.mkv":                                                             "web",
		"Film (2010) [Remux-2160p][TrueHD 7.1].mkv":                                            "remux",
		"Film.2010.1080p.BluRay.REMUX.AVC.mkv":                                                 "remux",
		"Show.S02E03.HDTV.x264.mkv":                                                            "hdtv",
		"Film.2001.DVDRip.XviD.mkv":                                                            "dvd",
		"Film (1999).mkv":                                                                      "",
		"Webcam Aufnahme.mkv":                                                                  "", // „Webcam“ ist kein „WEB“
		"Sowebdl.mkv":                                                                          "", // nur ganze Wörter
	} {
		if got := sourceTag(name); got != want {
			t.Errorf("sourceTag(%q) = %q, erwartet %q", name, got, want)
		}
	}
}

func TestHeightAndAudioClass(t *testing.T) {
	for h, want := range map[int]string{0: "", 360: "sd", 576: "sd", 698: "sd", 720: "720", 816: "720", 1000: "1080", 1080: "1080", 1920: "1080", 2160: "2160", 4320: "2160"} {
		if got := heightClass(h); got != want {
			t.Errorf("heightClass(%d) = %q, erwartet %q", h, got, want)
		}
	}
	if audioClass("dts", "DTS-HD MA") != "dtshd" || audioClass("dts", "DTS") != "dts" || audioClass("eac3", "") != "eac3" {
		t.Error("audioClass")
	}
}

// Die neuen Zähler (Auflösung, Ton, Quelle, Änderungszeit) laufen von den Ordnern in die Sammelzeile.
func TestLibraryRowsCarryProfile(t *testing.T) {
	mk := func(src, audio string, h int, mtime int64, files int) *libAgg {
		a := newAgg()
		a.files, a.bytes, a.dur = files, int64(files)*1_000_000, float64(files)*10
		for i := 0; i < files; i++ {
			a.addFacts(fileFacts{Size: 1_000_000, Mtime: mtime * 1e9, Dur: 10, Codec: "h264", Height: h, Audio: audio, Src: src})
		}
		a.dur, a.save = float64(files)*10, 0
		return a
	}
	rows := libraryRows("/lib", map[string]*libAgg{"/lib/Serie/S1": mk("webdl", "aac", 720, 1000, 3), "/lib/Serie/S2": mk("bluray", "dts", 1080, 2000, 2)})
	var g, s1 LibRow
	for _, r := range rows {
		if r.Path == "/lib/Serie" && r.Group {
			g = r
		}
		if r.Path == "/lib/Serie/S1" {
			s1 = r
		}
	}
	if g.Heights["720"] != 3 || g.Heights["1080"] != 2 || g.Audio["aac"] != 3 || g.Audio["dts"] != 2 || g.Sources["webdl"] != 3 || g.Sources["bluray"] != 2 || g.Newest != 2000 {
		t.Errorf("Sammelzeile: %+v", g)
	}
	if s1.Heights["720"] != 3 || s1.Sources["webdl"] != 3 || s1.Newest != 1000 {
		t.Errorf("Staffel 1: %+v", s1)
	}
}
