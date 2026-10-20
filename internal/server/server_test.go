package server

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/p5lukas/p5converter/internal/auth"
	"github.com/p5lukas/p5converter/internal/config"
	"github.com/p5lukas/p5converter/internal/ffmpeg"
	"github.com/p5lukas/p5converter/internal/logs"
	"github.com/p5lukas/p5converter/internal/version"
)

func init() { auth.Iter = 1000 } // fast hashes in tests

func newTestServer(t *testing.T, roots []string) (*Server, *httptest.Server) {
	t.Helper()
	tl, err := ffmpeg.Locate("")
	if err != nil {
		t.Skip("ffmpeg nicht installiert")
	}
	s := New(version.Get(), tl, roots, 2, t.TempDir())
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
	s.Jobs.CancelAll("")
	waitDone(t, s, 1)
	if j := s.Jobs.Snapshot()[0]; j.Status != "canceled" || j.Error != "" {
		t.Errorf("status %s, error %q (abgebrochen darf keinen Fehlertext zeigen)", j.Status, j.Error)
	}
	if m, _ := filepath.Glob(filepath.Join(root, "o", "*")); len(m) != 0 {
		t.Errorf("Reste nach Abbruch: %v", m)
	}
	if _, err := os.Stat(filepath.Join(root, "o")); err == nil {
		t.Error("vom Auftrag angelegter leerer Zielordner blieb nach dem Abbruch stehen")
	}
}

func TestInfoNewsManifest(t *testing.T) {
	_, ts := newTestServer(t, []string{t.TempDir()})
	var info struct {
		Version string                `json:"version"`
		Build   struct{ Base string } `json:"build"`
	}
	resp, _ := http.Get(ts.URL + "/api/info")
	json.NewDecoder(resp.Body).Decode(&info)
	if info.Version == "" || info.Build.Base != version.Base {
		t.Errorf("info: %+v", info)
	}
	var news newsReply
	resp, _ = http.Get(ts.URL + "/api/news")
	if err := json.NewDecoder(resp.Body).Decode(&news); err != nil || len(news.All) == 0 || news.All[0].Version == "" || news.Version != version.Base {
		t.Errorf("news: %v %+v", err, news)
	}
	resp, _ = http.Get(ts.URL + "/manifest.webmanifest")
	var mf map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&mf); err != nil || mf["display"] != "standalone" {
		t.Errorf("manifest: %v %v", err, mf)
	}
	resp, _ = http.Get(ts.URL + "/")
	if resp.Header.Get("Cache-Control") != "no-cache" || resp.StatusCode != 200 {
		t.Errorf("index: %d %q", resp.StatusCode, resp.Header.Get("Cache-Control"))
	}
}

func jar() *http.Client {
	j, _ := cookiejar.New(nil)
	return &http.Client{Jar: j}
}

func doJSON(t *testing.T, c *http.Client, method, url string, body any) (*http.Response, map[string]any) {
	t.Helper()
	var rd *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	} else {
		rd = bytes.NewReader(nil)
	}
	req, _ := http.NewRequest(method, url, rd)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	json.NewDecoder(resp.Body).Decode(&m)
	resp.Body.Close()
	return resp, m
}

func TestAuthFlow(t *testing.T) {
	_, ts := newTestServer(t, []string{t.TempDir()})
	c := jar()
	// login is off: everything open
	if r, _ := doJSON(t, c, "GET", ts.URL+"/api/settings", nil); r.StatusCode != 200 {
		t.Fatalf("settings offen: %d", r.StatusCode)
	}
	// too short password
	if r, m := doJSON(t, c, "POST", ts.URL+"/api/auth/setup", map[string]string{"username": "lukas", "password": "kurz"}); r.StatusCode != 400 {
		t.Errorf("kurzes Passwort: %d %v", r.StatusCode, m)
	}
	r, m := doJSON(t, c, "POST", ts.URL+"/api/auth/setup", map[string]string{"username": "lukas", "password": "geheimes-passwort"})
	if r.StatusCode != 200 || m["enabled"] != true || m["authenticated"] != true {
		t.Fatalf("setup: %d %v", r.StatusCode, m)
	}
	// the browser that set it up is signed in
	if r, _ := doJSON(t, c, "GET", ts.URL+"/api/settings", nil); r.StatusCode != 200 {
		t.Errorf("nach Setup eingeloggt: %d", r.StatusCode)
	}
	// a stranger is locked out of the API but not of the page
	stranger := jar()
	if r, m := doJSON(t, stranger, "GET", ts.URL+"/api/settings", nil); r.StatusCode != 401 || m["login"] != true {
		t.Errorf("Fremder: %d %v", r.StatusCode, m)
	}
	if r, _ := doJSON(t, stranger, "POST", ts.URL+"/api/jobs", map[string]any{}); r.StatusCode != 401 {
		t.Errorf("Aufträge ohne Anmeldung: %d", r.StatusCode)
	}
	if resp, err := stranger.Get(ts.URL + "/"); err != nil || resp.StatusCode != 200 {
		t.Errorf("Startseite muss öffentlich sein")
	}
	if resp, _ := stranger.Get(ts.URL + "/manifest.webmanifest"); resp.StatusCode != 200 {
		t.Errorf("Manifest muss öffentlich sein")
	}
	if _, m := doJSON(t, stranger, "GET", ts.URL+"/api/auth/state", nil); m["enabled"] != true || m["authenticated"] != false || m["fun"] != true {
		t.Errorf("state: %v", m)
	}
	// wrong password, then the right one
	if r, _ := doJSON(t, stranger, "POST", ts.URL+"/api/auth/login", map[string]any{"username": "lukas", "password": "falsch"}); r.StatusCode != 401 {
		t.Errorf("falsches Passwort: %d", r.StatusCode)
	}
	if r, _ := doJSON(t, stranger, "POST", ts.URL+"/api/auth/login", map[string]any{"username": "lukas", "password": "geheimes-passwort", "remember": true}); r.StatusCode != 200 {
		t.Fatalf("Login: %d", r.StatusCode)
	}
	if r, _ := doJSON(t, stranger, "GET", ts.URL+"/api/settings", nil); r.StatusCode != 200 {
		t.Errorf("nach Login: %d", r.StatusCode)
	}
	// cross-site login attempts stay blocked by the CSRF guard
	req, _ := http.NewRequest("POST", ts.URL+"/api/auth/login", bytes.NewReader([]byte(`{}`)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://evil.example")
	if resp, _ := http.DefaultClient.Do(req); resp.StatusCode != 403 {
		t.Errorf("fremder Origin: %d", resp.StatusCode)
	}
	// change password needs the current one; sessions of others end, this one stays signed in
	if r, _ := doJSON(t, c, "POST", ts.URL+"/api/auth/change", map[string]any{"current": "falsch", "newPassword": "neues-passwort-123"}); r.StatusCode != 400 {
		t.Errorf("Ändern mit falschem Passwort: %d", r.StatusCode)
	}
	if r, _ := doJSON(t, c, "POST", ts.URL+"/api/auth/change", map[string]any{"current": "geheimes-passwort", "newPassword": "neues-passwort-123"}); r.StatusCode != 200 {
		t.Fatalf("Ändern: %d", r.StatusCode)
	}
	if r, _ := doJSON(t, c, "GET", ts.URL+"/api/settings", nil); r.StatusCode != 200 {
		t.Errorf("nach Ändern noch eingeloggt: %d", r.StatusCode)
	}
	if r, _ := doJSON(t, stranger, "GET", ts.URL+"/api/settings", nil); r.StatusCode != 401 {
		t.Errorf("alte Sitzung muss enden: %d", r.StatusCode)
	}
	// fun line switch without password
	if _, m := doJSON(t, c, "POST", ts.URL+"/api/auth/change", map[string]any{"fun": false}); m["fun"] != false {
		t.Errorf("fun: %v", m)
	}
	// logout, then disable the login
	doJSON(t, c, "POST", ts.URL+"/api/auth/logout", nil)
	if r, _ := doJSON(t, c, "GET", ts.URL+"/api/settings", nil); r.StatusCode != 401 {
		t.Errorf("nach Logout: %d", r.StatusCode)
	}
	doJSON(t, c, "POST", ts.URL+"/api/auth/login", map[string]any{"username": "lukas", "password": "neues-passwort-123"})
	if r, _ := doJSON(t, c, "POST", ts.URL+"/api/auth/disable", map[string]any{"password": "falsch"}); r.StatusCode != 400 {
		t.Errorf("Ausschalten mit falschem Passwort: %d", r.StatusCode)
	}
	if r, m := doJSON(t, c, "POST", ts.URL+"/api/auth/disable", map[string]any{"password": "neues-passwort-123"}); r.StatusCode != 200 || m["enabled"] != false {
		t.Errorf("Ausschalten: %d %v", r.StatusCode, m)
	}
	if r, _ := doJSON(t, jar(), "GET", ts.URL+"/api/settings", nil); r.StatusCode != 200 {
		t.Errorf("ohne Anmeldung wieder offen: %d", r.StatusCode)
	}
}

func TestLoginRateLimitOverHTTP(t *testing.T) {
	_, ts := newTestServer(t, []string{t.TempDir()})
	c := jar()
	doJSON(t, c, "POST", ts.URL+"/api/auth/setup", map[string]string{"username": "lukas", "password": "geheimes-passwort"})
	attacker := jar()
	var last int
	for i := 0; i < 7; i++ {
		r, _ := doJSON(t, attacker, "POST", ts.URL+"/api/auth/login", map[string]any{"username": "lukas", "password": "falsch"})
		last = r.StatusCode
	}
	if last != 429 {
		t.Errorf("nach 6 Fehlversuchen erwartet 429, bekam %d", last)
	}
}

func TestSettingsEndpoint(t *testing.T) {
	s, ts := newTestServer(t, []string{t.TempDir()})
	c := jar()
	resp, err := c.Get(ts.URL + "/api/settings")
	if err != nil {
		t.Fatal(err)
	}
	var got struct {
		Settings   config.Settings `json:"settings"`
		Persistent bool            `json:"persistent"`
	}
	json.NewDecoder(resp.Body).Decode(&got)
	resp.Body.Close()
	if !got.Persistent || len(got.Settings.Presets) == 0 {
		t.Fatalf("Standard: %+v", got)
	}
	got.Settings.Concurrency = 3
	got.Settings.TrackRules.Audio = []config.AudioRule{{Codec: "dts", Ch: "any", Action: "encode", To: "eac3", Kbps: 256}}
	got.Settings.Presets[0].Name = "Mein Archiv"
	if r, _ := doJSON(t, c, "PUT", ts.URL+"/api/settings", got.Settings); r.StatusCode != 200 {
		t.Fatalf("PUT: %d", r.StatusCode)
	}
	if s.Jobs.Concurrency("video") != 3 {
		t.Errorf("parallele Aufträge nicht übernommen: %d", s.Jobs.Concurrency("video"))
	}
	if now := s.Settings.Get(); len(now.TrackRules.Audio) != 1 || now.TrackRules.Audio[0].To != "eac3" || now.Presets[0].Name != "Mein Archiv" {
		t.Errorf("nicht gespeichert: %+v", now.TrackRules)
	}
	got.Settings.TrackRules.Audio = []config.AudioRule{{Codec: "dts", Action: "encode", To: "wav"}}
	if r, m := doJSON(t, c, "PUT", ts.URL+"/api/settings", got.Settings); r.StatusCode != 400 {
		t.Errorf("ungültige Regel: %d %v", r.StatusCode, m)
	}
}

func TestRenameTool(t *testing.T) {
	dir := t.TempDir()
	_, ts := newTestServer(t, []string{dir})
	for _, n := range []string{"Show S01E01 [WEBDL].mkv", "Show S01E02 [WEBDL].mkv", "Show S01E02 [WEB].mkv", "Show.mkv"} {
		os.WriteFile(filepath.Join(dir, n), []byte("x"), 0o644)
	}
	items := []string{filepath.Join(dir, "Show S01E01 [WEBDL].mkv"), filepath.Join(dir, "Show S01E02 [WEBDL].mkv")}
	rules := []map[string]any{{"find": " [WEBDL]", "with": ""}}

	read := func(resp *http.Response) map[string]any {
		var m map[string]any
		json.NewDecoder(resp.Body).Decode(&m)
		return m
	}
	// preview changes nothing
	m := read(post(t, ts, "/api/rename/preview", map[string]any{"items": items, "replace": rules, "mode": "rename"}, nil))
	got := m["items"].([]any)
	if got[0].(map[string]any)["new"] != "Show S01E01.mkv" {
		t.Fatalf("Vorschau: %v", got)
	}
	if _, err := os.Stat(items[0]); err != nil {
		t.Fatal("Vorschau hat umbenannt")
	}
	// apply: first works, second collides with nothing -> both fine
	m = read(post(t, ts, "/api/rename", map[string]any{"items": items, "replace": rules}, nil))
	if m["renamed"].(float64) != 2 || m["failed"].(float64) != 0 {
		t.Fatalf("Umbenennen: %v", m)
	}
	if _, err := os.Stat(filepath.Join(dir, "Show S01E02.mkv")); err != nil {
		t.Error("Datei fehlt nach Umbenennen")
	}
	// collision: never overwrites an existing file
	os.WriteFile(filepath.Join(dir, "Show S01E02 [WEB].mkv"), []byte("keep"), 0o644)
	m = read(post(t, ts, "/api/rename", map[string]any{"items": []string{filepath.Join(dir, "Show S01E02 [WEB].mkv")}, "replace": []map[string]any{{"find": " [WEB]", "with": ""}}}, nil))
	if m["failed"].(float64) != 1 {
		t.Errorf("Kollision muss abgelehnt werden: %v", m)
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "Show S01E02.mkv")); string(b) != "x" {
		t.Error("vorhandene Datei überschrieben")
	}
	// outside the roots; special characters are plain text; too many rules are refused
	m = read(post(t, ts, "/api/rename", map[string]any{"items": []string{"/etc/hostname"}, "replace": rules}, nil))
	if m["failed"].(float64) != 1 {
		t.Errorf("Pfad außerhalb der Roots: %v", m)
	}
	if r := post(t, ts, "/api/rename/preview", map[string]any{"items": items, "replace": []map[string]any{{"find": "(", "regex": true}}}, nil); r.StatusCode != 200 {
		t.Errorf("Klammer (altes Feld regex wird ignoriert) muss normaler Text sein: %d", r.StatusCode)
	}
	tooMany := make([]map[string]any, 13)
	for i := range tooMany {
		tooMany[i] = map[string]any{"find": "x"}
	}
	if r := post(t, ts, "/api/rename/preview", map[string]any{"items": items, "replace": tooMany}, nil); r.StatusCode != 400 {
		t.Errorf("zu viele Ersetzungen: %d", r.StatusCode)
	}
	// converter: output name uses variables and rules (invalid rules are refused on submit)
	if r := post(t, ts, "/api/jobs", map[string]any{"kind": "audio", "items": []map[string]any{{"path": items[0]}},
		"output": map[string]any{"replace": tooMany}}, nil); r.StatusCode != 400 {
		t.Errorf("Auftrag mit zu vielen Ersetzungen: %d", r.StatusCode)
	}
}

// every script/style referenced by the page must be embedded and served with the right type
func TestPageAssetsServed(t *testing.T) {
	_, ts := newTestServer(t, nil)
	resp, _ := http.Get(ts.URL + "/")
	var page bytes.Buffer
	page.ReadFrom(resp.Body)
	refs := regexp.MustCompile(`(?:src|href)="/?([a-z0-9.-]+\.(?:js|css|png|ico))(?:\?v=[^"]*)?"`).FindAllStringSubmatch(page.String(), -1)
	if len(refs) < 12 {
		t.Fatalf("zu wenige Verweise gefunden: %d", len(refs))
	}
	for _, m := range refs {
		r, err := http.Get(ts.URL + "/" + m[1])
		if err != nil || r.StatusCode != 200 {
			t.Errorf("%s nicht ausgeliefert: %v %v", m[1], err, r)
			continue
		}
		if ct := r.Header.Get("Content-Type"); strings.HasSuffix(m[1], ".js") && !strings.Contains(ct, "javascript") {
			t.Errorf("%s: Content-Type %q", m[1], ct)
		}
	}
}

// the start page needs the lifetime totals in the state, and finished jobs must feed them
func TestStateCarriesSavedTotals(t *testing.T) {
	s, ts := newTestServer(t, nil)
	s.Stats.Add("video", 1000, 250)
	resp, err := http.Get(ts.URL + "/api/state")
	if err != nil {
		t.Fatal(err)
	}
	var st struct {
		Saved struct {
			Video struct {
				Count   int
				In, Out int64
			}
			Audio struct{ Count int }
		}
		Concurrency map[string]int
	}
	json.NewDecoder(resp.Body).Decode(&st)
	if st.Saved.Video.Count != 1 || st.Saved.Video.In != 1000 || st.Saved.Video.Out != 250 || st.Saved.Audio.Count != 0 {
		t.Errorf("gewonnener Platz fehlt im Zustand: %+v", st.Saved)
	}
	if st.Concurrency["audio"] < 1 || st.Concurrency["video"] < 1 {
		t.Errorf("Parallelität je Welt fehlt: %v", st.Concurrency)
	}
}

func TestLogAPI(t *testing.T) {
	_, ts := newTestServer(t, []string{t.TempDir()})
	logs.Get("test").Infof("Probe mit password=geheim123")
	logs.Get("test").Errorf("Kaputt")
	get := func(path string) map[string]any {
		resp, err := http.Get(ts.URL + path)
		if err != nil || resp.StatusCode != 200 {
			t.Fatalf("%s: %v %v", path, err, resp)
		}
		var m map[string]any
		json.NewDecoder(resp.Body).Decode(&m)
		return m
	}
	r := get("/api/logs/read?tail=50")
	b, _ := json.Marshal(r)
	if !strings.Contains(string(b), "Probe mit password=***") || strings.Contains(string(b), "geheim123") {
		t.Errorf("Log-Antwort: %s", b)
	}
	if a := get("/api/logs/alerts?since=0"); a["errors"].(float64) < 1 {
		t.Errorf("Fehlerzähler: %v", a)
	}
	if resp, _ := http.Get(ts.URL + "/api/logs/read?file=../../etc/passwd"); resp.StatusCode != 400 {
		t.Errorf("Pfad-Trick: %d", resp.StatusCode)
	}
	if resp := post(t, ts, "/api/logs/clear", map[string]string{"file": "p5converter.log"}, nil); resp.StatusCode != 200 {
		t.Errorf("leeren: %d", resp.StatusCode)
	}
	// clearing needs the JSON content type like every other write (CSRF guard)
	req, _ := http.NewRequest("POST", ts.URL+"/api/logs/clear", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "text/plain")
	if resp, _ := http.DefaultClient.Do(req); resp.StatusCode != 415 {
		t.Errorf("CSRF beim Leeren: %d", resp.StatusCode)
	}
}

// icons carry the version (new version = new tab icon at once), the placeholder never reaches the browser,
// /favicon.ico exists, and the manifest icons are versioned as well
func TestIconLinksAreVersioned(t *testing.T) {
	s, ts := newTestServer(t, nil)
	resp, _ := http.Get(ts.URL + "/")
	var page bytes.Buffer
	page.ReadFrom(resp.Body)
	v := "?v=" + s.Build.Base
	for _, w := range []string{"/favicon.ico" + v, "/favicon-32.png" + v, "/apple-touch-icon.png" + v, "/manifest.webmanifest" + v} {
		if !strings.Contains(page.String(), w) {
			t.Errorf("Seite verweist nicht auf %s", w)
		}
	}
	if strings.Contains(page.String(), "__V__") {
		t.Error("Platzhalter __V__ steht noch in der Seite")
	}
	if r, _ := http.Get(ts.URL + "/favicon.ico"); r.StatusCode != 200 || r.Header.Get("Cache-Control") != "no-cache" {
		t.Errorf("/favicon.ico: %d %q", r.StatusCode, r.Header.Get("Cache-Control"))
	}
	r, _ := http.Get(ts.URL + "/manifest.webmanifest")
	var m bytes.Buffer
	m.ReadFrom(r.Body)
	if !strings.Contains(m.String(), "icon-192.png"+v) {
		t.Errorf("Manifest-Icons ohne Version: %s", m.String())
	}
}

func getJSON(t *testing.T, ts *httptest.Server, path string, v any) {
	t.Helper()
	resp, err := http.Get(ts.URL + path)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if err := json.NewDecoder(resp.Body).Decode(v); err != nil {
		t.Fatal(err)
	}
}

func TestVersionKey(t *testing.T) {
	if !(vKey("0.0.10") > vKey("0.0.9") && vKey("0.1.0") > vKey("0.0.99") && vKey("v0.0.9") == vKey("0.0.9")) {
		t.Error("Versionsvergleich")
	}
}

// Neuigkeiten: Update einer älteren Version zeigt den Hinweis einmal, frische Installation nie; der Merker liegt auf dem Server.
func TestNewsNoticeOncePerVersion(t *testing.T) {
	entries := []newsEntry{{ID: "a", Version: "0.0.9", Title: "Alt"}, {ID: "b", Version: "0.0.10", Title: "Neu 1"}, {ID: "c", Version: "0.0.10", Title: "Neu 2"}}
	cur := "0.0.10"

	// frische Installation: leerer Ordner → nichts zeigen
	fresh := openNews(t.TempDir(), true, entries, cur)
	if fresh.state.VersionSeen != cur || len(fresh.state.Seen) != 3 {
		t.Errorf("frisch: %+v", fresh.state)
	}

	// Update: Ordner hat schon Einstellungen, aber keinen Merker
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "settings.json"), []byte(`{"showNews":true}`), 0o644)
	tl, err := ffmpeg.Locate("")
	if err != nil {
		t.Skip("ffmpeg nicht installiert")
	}
	b := version.Get()
	b.Base = cur
	s := New(b, tl, nil, 1, dir)
	s.newsEntries = entries
	os.Remove(filepath.Join(dir, "news-seen.json")) // New() hat mit den echten Einträgen schon einen Merker angelegt
	s.news = openNews(dir, true, entries, cur)
	ts := httptest.NewServer(s.Handler())
	defer ts.Close()
	var r newsReply
	getJSON(t, ts, "/api/news", &r)
	if !r.Show || r.Count != 2 || len(r.Highlights) != 2 || r.Highlights[0] != "Neu 1" {
		t.Fatalf("Update zeigt den Hinweis: %+v", r)
	}
	post(t, ts, "/api/news/seen", map[string]any{"ids": []string{"b", "nix"}, "version": true}, nil).Body.Close()
	getJSON(t, ts, "/api/news", &r)
	if r.Show || r.Count != 0 {
		t.Errorf("nach „gesehen“ kein Hinweis mehr: %+v", r)
	}
	seen := map[string]bool{}
	for _, id := range r.Seen {
		seen[id] = true
	}
	if !seen["a"] || !seen["b"] || seen["c"] || seen["nix"] {
		t.Errorf("gelesen: %v", r.Seen)
	}
	// überlebt einen Neustart
	if again := openNews(dir, true, entries, cur); again.state.VersionSeen != cur {
		t.Errorf("Merker nicht gespeichert: %+v", again.state)
	}
	// „Neuigkeiten anzeigen“ aus → kein Hinweis
	s.news.state.VersionSeen = "0.0.9"
	cfg := s.Settings.Get()
	cfg.ShowNews = false
	if _, err := s.Settings.Put(cfg); err != nil {
		t.Fatal(err)
	}
	if s.newsReply().Show {
		t.Error("showNews=false muss den Hinweis unterdrücken")
	}
}

func TestStatsResetPerWorld(t *testing.T) {
	s, ts := newTestServer(t, nil)
	s.Stats.Add("audio", 100, 50)
	s.Stats.Add("video", 100, 40)
	if resp := post(t, ts, "/api/stats/reset", map[string]string{"kind": "x"}, nil); resp.StatusCode != 400 {
		t.Errorf("ungültige Welt: %d", resp.StatusCode)
	}
	post(t, ts, "/api/stats/reset", map[string]string{"kind": "audio"}, nil).Body.Close()
	g := s.Stats.Get()
	if g.Audio.Count != 0 || g.Video.Count != 1 {
		t.Errorf("nur Audio zurücksetzen: %+v", g)
	}
}

// Windows-App: ein zweiter Start bittet das laufende Programm über die Adresse, sein Fenster zu zeigen.
func TestDesktopShow(t *testing.T) {
	s, ts := newTestServer(t, nil)
	if resp := post(t, ts, "/api/desktop/show", map[string]string{}, nil); resp.StatusCode != 404 {
		t.Errorf("ohne App-Fenster: %d", resp.StatusCode)
	}
	called := make(chan struct{}, 1)
	s.ShowWindow = func() { called <- struct{}{} }
	if resp := post(t, ts, "/api/desktop/show", map[string]string{}, nil); resp.StatusCode != 200 {
		t.Errorf("mit App-Fenster: %d", resp.StatusCode)
	}
	select {
	case <-called:
	default:
		t.Error("ShowWindow wurde nicht aufgerufen")
	}
}

func TestShortUA(t *testing.T) {
	if got := shortUA("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0"); got != "Safari/537.36 Edg/154.0.0.0" {
		t.Errorf("shortUA: %q", got)
	}
}

// Kontrolle nach der Konvertierung: Spuren + Decode-Test bestanden, Quelle wird erst danach gelöscht.
func TestVerifyThenDelete(t *testing.T) {
	root := t.TempDir()
	s, ts := newTestServer(t, []string{root})
	src := filepath.Join(root, "v.mkv")
	if out, err := exec.Command("ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x240:r=25:d=4", "-f", "lavfi", "-i", "sine=f=440:d=4",
		"-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", src).CombinedOutput(); err != nil {
		t.Fatalf("%v %s", err, out)
	}
	r := post(t, ts, "/api/jobs", map[string]any{"kind": "video", "items": []map[string]string{{"path": src}},
		"output": map[string]any{"dir": filepath.Join(root, "o"), "structure": "flat", "deleteSource": true, "verifyTracks": true, "verifyDecode": true},
		"video":  map[string]any{"codec": "copy", "container": "mkv", "audioMode": "copy", "subMode": "copy"}}, nil)
	if r.StatusCode != 200 {
		t.Fatalf("submit %d", r.StatusCode)
	}
	waitDone(t, s, 1)
	j := s.Jobs.Snapshot()[0]
	if j.Status != "done" || j.CheckFailed || len(j.Checks) != 4 {
		t.Fatalf("status=%s fehler=%q prüfungen=%+v warnungen=%v", j.Status, j.Error, j.Checks, j.Warnings)
	}
	if _, err := os.Stat(src); err == nil {
		t.Error("Quelle nach bestandener Prüfung nicht gelöscht")
	}
}

// Verlauf: jeder beendete Auftrag landet im Verlauf (je Art oder gemeinsam), die Liste überlebt „Fertige entfernen“, CSV und Leeren je Art.
func TestHistory(t *testing.T) {
	root := t.TempDir()
	s, ts := newTestServer(t, []string{root})
	src := filepath.Join(root, "song.wav")
	if out, err := exec.Command("ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=440:d=1", src).CombinedOutput(); err != nil {
		t.Fatalf("%v %s", err, out)
	}
	post(t, ts, "/api/jobs", map[string]any{"kind": "audio", "items": []map[string]string{{"path": src}},
		"output": map[string]any{"dir": filepath.Join(root, "o"), "structure": "flat", "exists": "rename", "verifyTracks": true},
		"audio":  map[string]any{"format": "mp3", "mode": "vbr", "quality": 4}}, nil)
	waitDone(t, s, 1)
	// nicht vorhandene Datei: endet mit Fehler (Eintrag mit Befehl/Log)
	post(t, ts, "/api/jobs", map[string]any{"kind": "audio", "items": []map[string]string{{"path": filepath.Join(root, "fehlt.wav")}},
		"output": map[string]any{"dir": filepath.Join(root, "o")}, "audio": map[string]any{"format": "mp3", "mode": "vbr", "quality": 4}}, nil)
	waitDone(t, s, 2)
	time.Sleep(300 * time.Millisecond)
	post(t, ts, "/api/jobs/clear", map[string]any{"kind": "audio"}, nil) // „Fertige entfernen“
	get := func(path string) map[string]any {
		resp, err := http.Get(ts.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var m map[string]any
		json.NewDecoder(resp.Body).Decode(&m)
		return m
	}
	m := get("/api/history?kind=audio")
	items, _ := m["items"].([]any)
	if len(items) != 2 || m["max"].(float64) != 100 {
		t.Fatalf("erwartet 2 Einträge, max 100: %v", m)
	}
	if st := items[0].(map[string]any)["status"]; st != "error" {
		t.Errorf("neuester Eintrag zuerst (Fehler erwartet): %v", st)
	}
	if v := get("/api/history?kind=video")["items"].([]any); len(v) != 0 {
		t.Errorf("Video-Verlauf muss leer sein (Arten getrennt): %v", v)
	}
	resp, _ := http.Get(ts.URL + "/api/history.csv?kind=audio")
	b, _ := io.ReadAll(resp.Body)
	if !strings.Contains(resp.Header.Get("Content-Disposition"), "verlauf-audio.csv") || !strings.Contains(string(b), "song.wav") || !strings.Contains(string(b), "Ende;Datei") {
		t.Errorf("CSV unvollständig: %s", b)
	}
	if r := post(t, ts, "/api/history/clear", map[string]any{"kind": "video"}, nil); r.StatusCode != 200 {
		t.Fatal("clear video")
	}
	if len(get("/api/history?kind=audio")["items"].([]any)) != 2 {
		t.Error("Leeren von Video darf Audio nicht berühren")
	}
	// eine gemeinsame Liste für beide Arten (ohne kind oder mit kind=all), „alle“ leert beide
	if all := get("/api/history")["items"].([]any); len(all) != 2 {
		t.Errorf("gemeinsame Liste: %d Einträge statt 2", len(all))
	}
	if all := get("/api/history?kind=all")["items"].([]any); len(all) != 2 {
		t.Errorf("kind=all: %d Einträge statt 2", len(all))
	}
	post(t, ts, "/api/history/clear", map[string]any{"kind": "all"}, nil)
	if len(get("/api/history?kind=all")["items"].([]any)) != 0 {
		t.Error("kind=all leert nicht beide Arten")
	}
	post(t, ts, "/api/history/clear", map[string]any{"kind": "audio"}, nil)
	if len(get("/api/history?kind=audio")["items"].([]any)) != 0 {
		t.Error("Audio-Verlauf nicht geleert")
	}
	if r, _ := http.Get(ts.URL + "/api/history?kind=x"); r.StatusCode != 400 {
		t.Error("ungültige Art muss abgelehnt werden")
	}
}

func TestStaticETagAndGzip(t *testing.T) {
	s, _ := newTestServer(t, nil)
	h := s.Handler()
	get := func(path string, hdr map[string]string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", path, nil)
		for k, v := range hdr {
			r.Header.Set(k, v)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	w := get("/app.js", nil)
	if w.Code != 200 || w.Header().Get("ETag") == "" || !strings.Contains(w.Header().Get("Content-Type"), "javascript") {
		t.Fatalf("app.js: %d %v", w.Code, w.Header())
	}
	if w.Header().Get("Content-Encoding") != "" {
		t.Error("ohne Accept-Encoding darf nicht komprimiert werden")
	}
	plain := w.Body.Len()
	if w2 := get("/app.js", map[string]string{"If-None-Match": w.Header().Get("ETag")}); w2.Code != 304 || w2.Body.Len() != 0 {
		t.Errorf("erwartet 304, erhalten %d", w2.Code)
	}
	gz := get("/app.js", map[string]string{"Accept-Encoding": "gzip"})
	if gz.Header().Get("Content-Encoding") != "gzip" || gz.Body.Len() >= plain {
		t.Errorf("gzip fehlt oder nicht kleiner: %d vs %d", gz.Body.Len(), plain)
	}
	zr, err := gzip.NewReader(gz.Body)
	if err != nil {
		t.Fatal(err)
	}
	un, _ := io.ReadAll(zr)
	if !bytes.Equal(un, w.Body.Bytes()) {
		t.Error("entpackter Inhalt weicht ab")
	}
	if p := get("/icon-192.png", map[string]string{"Accept-Encoding": "gzip"}); p.Code != 200 || p.Header().Get("Content-Encoding") != "" || p.Header().Get("Content-Type") != "image/png" {
		t.Errorf("PNG: %d %v", p.Code, p.Header())
	}
	if get("/gibt-es-nicht.js", nil).Code != 404 {
		t.Error("unbekannte Datei muss 404 liefern")
	}
	if get("/index.html", nil).Code != 200 || get("/", nil).Code != 200 {
		t.Error("Startseite")
	}
}

func TestBrowseSearch(t *testing.T) {
	dir := t.TempDir()
	sub := filepath.Join(dir, "Filme", "Müller Serie", "Staffel 1")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	os.MkdirAll(filepath.Join(dir, ".versteckt", "Müller"), 0o755)
	for _, f := range []string{filepath.Join(sub, "Mueller S01E01.mkv"), filepath.Join(sub, "notizen müller.txt"), filepath.Join(dir, "Filme", "andere.mp3"), filepath.Join(dir, ".versteckt", "Müller", "x.mkv")} {
		os.WriteFile(f, []byte("x"), 0o644)
	}
	_, ts := newTestServer(t, []string{dir})
	get := func(q string) (int, struct {
		Hits []struct {
			Name, Path string
			Dir        bool
			Media      string
		}
		Truncated bool
	}) {
		var out struct {
			Hits []struct {
				Name, Path string
				Dir        bool
				Media      string
			}
			Truncated bool
		}
		resp, err := http.Get(ts.URL + "/api/fs/search?" + q)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		json.NewDecoder(resp.Body).Decode(&out)
		return resp.StatusCode, out
	}
	code, r := get("path=" + url.QueryEscape(dir) + "&q=MUELLER")
	if code != 200 || len(r.Hits) != 2 {
		t.Fatalf("Suche „MUELLER“ (ä = a, Groß/Klein egal): %d %+v", code, r)
	}
	if !r.Hits[0].Dir || r.Hits[0].Name != "Filme/Müller Serie" || r.Hits[1].Media != "video" || !strings.HasSuffix(r.Hits[1].Path, "Mueller S01E01.mkv") {
		t.Errorf("Treffer: %+v", r.Hits)
	}
	for _, h := range r.Hits {
		if strings.Contains(h.Path, ".versteckt") || strings.HasSuffix(h.Path, ".txt") {
			t.Errorf("versteckter Ordner oder Nicht-Medium im Ergebnis: %s", h.Path)
		}
	}
	if _, r = get("path=" + url.QueryEscape(dir) + "&q=muller"); len(r.Hits) != 1 || !r.Hits[0].Dir {
		t.Errorf("auch „muller“ (ohne Umlaut) findet Müller (den Ordner, nicht „Mueller“): %+v", r.Hits)
	}
	if _, r = get("q=staffel&dirs=1"); len(r.Hits) != 1 || !r.Hits[0].Dir {
		t.Errorf("ohne path suchen alle erlaubten Wurzeln, dirs=1 nur Ordner: %+v", r.Hits)
	}
	if code, _ = get("q=a"); code != 400 {
		t.Errorf("zu kurze Suche: %d", code)
	}
	if code, _ = get("path=/etc&q=passwd"); code != 403 {
		t.Errorf("fremder Pfad: %d", code)
	}
	if _, r = get("path=" + url.QueryEscape(dir) + "&q=gibtesnicht"); len(r.Hits) != 0 {
		t.Errorf("Suche ohne Treffer: %+v", r.Hits)
	}
}
