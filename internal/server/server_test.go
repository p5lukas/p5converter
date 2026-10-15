package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/p5lukas/p5converter/internal/ffmpeg"
)

func newTestServer(t *testing.T, roots []string) (*Server, *httptest.Server) {
	t.Helper()
	tl, err := ffmpeg.Locate("")
	if err != nil {
		t.Skip("ffmpeg nicht installiert")
	}
	s := New("test", tl, roots, 2)
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	return s, ts
}

func post(t *testing.T, ts *httptest.Server, path string, body any, hdr map[string]string) *http.Response {
	t.Helper()
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest("POST", ts.URL+path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func TestCSRFAndRoots(t *testing.T) {
	dir := t.TempDir()
	_, ts := newTestServer(t, []string{dir})

	// wrong content type (classic CSRF form post)
	req, _ := http.NewRequest("POST", ts.URL+"/api/jobs/cancel-all", bytes.NewReader([]byte("{}")))
	req.Header.Set("Content-Type", "text/plain")
	if resp, _ := http.DefaultClient.Do(req); resp.StatusCode != 415 {
		t.Errorf("text/plain: %d", resp.StatusCode)
	}
	// foreign origin
	if resp := post(t, ts, "/api/jobs/cancel-all", map[string]any{}, map[string]string{"Origin": "http://evil.example"}); resp.StatusCode != 403 {
		t.Errorf("origin: %d", resp.StatusCode)
	}
	// browsing outside the roots
	resp, _ := http.Get(ts.URL + "/api/fs?path=/etc")
	if resp.StatusCode != 403 {
		t.Errorf("fs /etc: %d", resp.StatusCode)
	}
	resp, _ = http.Get(ts.URL + "/api/fs?path=" + dir + "/../../etc")
	if resp.StatusCode != 403 {
		t.Errorf("fs traversal: %d", resp.StatusCode)
	}
	// job with source outside roots
	r := post(t, ts, "/api/jobs", map[string]any{"kind": "audio", "items": []map[string]string{{"path": "/etc/passwd"}}}, nil)
	if r.StatusCode != 403 {
		t.Errorf("job outside roots: %d", r.StatusCode)
	}
	// quit not available in server mode
	if r := post(t, ts, "/api/quit", map[string]any{}, nil); r.StatusCode != 403 {
		t.Errorf("quit: %d", r.StatusCode)
	}
}

func waitDone(t *testing.T, s *Server, n int) {
	t.Helper()
	for i := 0; i < 400; i++ {
		done := 0
		for _, j := range s.Jobs.Snapshot() {
			if j.Status != "queued" && j.Status != "running" {
				done++
			}
		}
		if done >= n {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatal("Timeout")
}

// Two identical outputs in parallel must not clobber each other; delete-source only after a verified result.
func TestJobsCollisionAndDelete(t *testing.T) {
	root := t.TempDir()
	s, ts := newTestServer(t, []string{root})
	for _, d := range []string{"a", "b", "out"} {
		os.Mkdir(filepath.Join(root, d), 0o755)
	}
	for _, d := range []string{"a", "b"} {
		out, err := exec.Command("ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=440:d=1", "-metadata", "title=T", filepath.Join(root, d, "song.wav")).CombinedOutput()
		if err != nil {
			t.Fatalf("%v %s", err, out)
		}
	}
	items := []map[string]string{{"path": filepath.Join(root, "a", "song.wav")}, {"path": filepath.Join(root, "b", "song.wav")}}
	r := post(t, ts, "/api/jobs", map[string]any{
		"kind": "audio", "items": items,
		"output": map[string]any{"dir": filepath.Join(root, "out"), "structure": "flat", "exists": "rename", "deleteSource": true},
		"audio":  map[string]any{"format": "mp3", "mode": "vbr", "quality": 4},
	}, nil)
	if r.StatusCode != 200 {
		t.Fatalf("submit: %d", r.StatusCode)
	}
	waitDone(t, s, 2)
	files, _ := filepath.Glob(filepath.Join(root, "out", "*"))
	if len(files) != 2 {
		t.Fatalf("erwartet 2 Ausgabedateien, gefunden %v", files)
	}
	for _, j := range s.Jobs.Snapshot() {
		if j.Status != "done" {
			t.Errorf("job %s: %s %s", j.ID, j.Status, j.Error)
		}
	}
	for _, d := range []string{"a", "b"} {
		if _, err := os.Stat(filepath.Join(root, d, "song.wav")); err == nil {
			t.Errorf("Quelle %s nicht gelöscht", d)
		}
	}
	if left, _ := filepath.Glob(filepath.Join(root, "out", "*.part")); len(left) != 0 {
		t.Errorf(".part übrig: %v", left)
	}
}

func TestHardwareRejectedAndCancel(t *testing.T) {
	root := t.TempDir()
	s, ts := newTestServer(t, []string{root})
	for i := 0; i < 100 && !s.Det.Result().Done; i++ {
		time.Sleep(100 * time.Millisecond)
	}
	src := filepath.Join(root, "v.mkv")
	if out, err := exec.Command("ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=25:d=60", "-c:v", "libx264", "-preset", "ultrafast", src).CombinedOutput(); err != nil {
		t.Fatalf("%v %s", err, out)
	}
	// hardware backend that is not available must be rejected, not silently replaced
	r := post(t, ts, "/api/jobs", map[string]any{"kind": "video", "items": []map[string]string{{"path": src}},
		"video": map[string]any{"codec": "hevc", "backend": "nvenc", "crf": 24}}, nil)
	if r.StatusCode != 400 && !s.Det.Result().Done {
		t.Logf("detect not done: %d", r.StatusCode)
	} else if r.StatusCode != 400 {
		// only acceptable if this machine really has NVENC
		for _, b := range s.Det.Result().Backends {
			if b.ID == "nvenc" && b.Codecs["hevc"] {
				return
			}
		}
		t.Errorf("nvenc ohne Hardware angenommen: %d", r.StatusCode)
	}
	// cancel a running job, no partial file may remain
	r = post(t, ts, "/api/jobs", map[string]any{"kind": "video", "items": []map[string]string{{"path": src}},
		"output": map[string]any{"dir": filepath.Join(root, "o")},
		"video":  map[string]any{"codec": "hevc", "backend": "cpu", "crf": 24, "preset": "slow"}}, nil)
	if r.StatusCode != 200 {
		t.Fatalf("submit %d", r.StatusCode)
	}
	time.Sleep(1500 * time.Millisecond)
	s.Jobs.CancelAll()
	waitDone(t, s, 1)
	if st := s.Jobs.Snapshot()[0].Status; st != "canceled" {
		t.Errorf("status %s", st)
	}
	if m, _ := filepath.Glob(filepath.Join(root, "o", "*")); len(m) != 0 {
		t.Errorf("Reste nach Abbruch: %v", m)
	}
}
