package server

import (
	"encoding/json"
	"net/http"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// Probeclip: ein Ausschnitt wird mit zwei Einstellungen (CPU, Stufen CRF 20 und 32) umgewandelt; Größe, SSIM/PSNR und Bilder kommen zurück,
// die kleinere Qualität ist kleiner; unerlaubte Pfade, „Kopieren“ und unbekannte Hardware werden abgelehnt.
func TestClipCompare(t *testing.T) {
	dir := t.TempDir()
	_, ts := newTestServer(t, []string{dir})
	src := filepath.Join(dir, "quelle.mkv")
	out, err := exec.Command("ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24:duration=6", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18", src).CombinedOutput()
	if err != nil {
		t.Skip("kein Testvideo möglich: " + string(out))
	}
	// Ablehnungen
	if r := post(t, ts, "/api/clip", map[string]any{"path": "/etc/passwd", "variants": []any{map[string]any{"video": map[string]any{"codec": "hevc"}}}}, nil); r.StatusCode != 403 {
		t.Errorf("Pfad außerhalb: %d", r.StatusCode)
	}
	if r := post(t, ts, "/api/clip", map[string]any{"path": src, "variants": []any{map[string]any{"video": map[string]any{"codec": "copy"}}}}, nil); r.StatusCode != 400 {
		t.Errorf("copy: %d", r.StatusCode)
	}
	if r := post(t, ts, "/api/clip", map[string]any{"path": src, "variants": []any{}}, nil); r.StatusCode != 400 {
		t.Errorf("keine Varianten: %d", r.StatusCode)
	}

	mk := func(crf int) map[string]any {
		return map[string]any{"label": "CPU", "video": map[string]any{"codec": "h264", "backend": "cpu", "crf": crf, "preset": "veryfast"}}
	}
	resp := post(t, ts, "/api/clip", map[string]any{"path": src, "seconds": 3, "variants": []any{mk(20), mk(34)}}, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("Start: %d", resp.StatusCode)
	}
	var started struct{ ID string }
	json.NewDecoder(resp.Body).Decode(&started)
	// zweiter Lauf gleichzeitig wird abgelehnt
	if r := post(t, ts, "/api/clip", map[string]any{"path": src, "variants": []any{mk(20)}}, nil); r.StatusCode != 409 {
		t.Errorf("zweiter Lauf: %d", r.StatusCode)
	}
	var run ClipRun
	deadline := time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		getJSON(t, ts, "/api/clip/"+started.ID, &run)
		if run.Status != "läuft" {
			break
		}
		time.Sleep(200 * time.Millisecond)
	}
	if run.Status != "fertig" {
		t.Fatalf("Status %q: %s", run.Status, run.Error)
	}
	if run.Length < 2.9 || run.Length > 3.1 || run.SrcSize == 0 || len(run.Images) != 2 {
		t.Errorf("Quelle: Länge %.2f, Größe %d, Bilder %v", run.Length, run.SrcSize, run.Images)
	}
	a, b := run.Variants[0], run.Variants[1]
	for _, v := range run.Variants {
		if v.Status != "fertig" || v.Size == 0 || v.SSIM <= 0.5 || v.SSIM > 1 || v.PSNR < 20 || len(v.Images) != 2 || v.Speed <= 0 {
			t.Errorf("Ergebnis unvollständig: %+v", *v)
		}
	}
	if !(b.Size < a.Size) {
		t.Errorf("CRF 34 (%d Bytes) sollte kleiner sein als CRF 20 (%d Bytes)", b.Size, a.Size)
	}
	if !(b.SSIM < a.SSIM) {
		t.Errorf("CRF 34 (SSIM %.4f) sollte schlechter sein als CRF 20 (%.4f)", b.SSIM, a.SSIM)
	}
	// Bild abrufbar, fremde Namen nicht
	r, err := http.Get(ts.URL + "/api/clip/" + started.ID + "/img/" + a.Images[0])
	if err != nil || r.StatusCode != 200 || r.Header.Get("Content-Type") != "image/png" {
		t.Errorf("Bild: %v %v", err, r)
	}
	if r, _ := http.Get(ts.URL + "/api/clip/" + started.ID + "/img/..%2Fsrc.mkv"); r.StatusCode == 200 {
		t.Errorf("Pfad im Bildnamen wurde nicht abgelehnt")
	}
}
