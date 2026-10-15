package logs

import (
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func fresh(t *testing.T, dir string) {
	t.Helper()
	mu.Lock()
	ring, lineSeq, alertSeq, alertEv, size = nil, 0, 0, nil, 0
	mu.Unlock()
	SetConsole(io.Discard)
	Setup(dir)
	t.Cleanup(func() { Setup("") })
}

func TestRedactionNeverLeaksSecrets(t *testing.T) {
	cases := []string{
		"Anmeldung mit password=geheim123 fehlgeschlagen",
		`{"password":"geheim123"}`,
		"Cookie p5c_session=abcdef123456 gesetzt",
		"Authorization: Bearer geheim123",
		"api_key=geheim123&x=1",
	}
	for _, c := range cases {
		if got := Redact(c); strings.Contains(got, "geheim123") || strings.Contains(got, "abcdef123456") {
			t.Errorf("Geheimnis nicht geschwärzt: %q -> %q", c, got)
		}
	}
	if got := Redact("Auftrag j1 fertig"); got != "Auftrag j1 fertig" {
		t.Errorf("harmlose Zeile verändert: %q", got)
	}
}

func TestFileLogReadLiveAndAlerts(t *testing.T) {
	cfg := t.TempDir()
	fresh(t, cfg)
	l := Get("jobs")
	l.Infof("Start")
	l.Warnf("Hinweis mit password=geheim123")
	l.Errorf("Fehler\nzweite Zeile")
	data, _ := os.ReadFile(filepath.Join(cfg, "logs", Name))
	if strings.Contains(string(data), "geheim123") || !strings.Contains(string(data), "[WARNING] jobs | Hinweis") {
		t.Fatalf("Logdatei: %s", data)
	}
	r, err := Read(Name, 1000, 0, false)
	if err != nil || len(r.Entries) != 3 || r.Entries[2].Msg != "Fehler\nzweite Zeile" || r.Entries[2].Level != "ERROR" || r.Entries[0].Src != "jobs" {
		t.Fatalf("%+v %v", r, err)
	}
	// live: only what is new since the offset
	l.Infof("neu")
	r2, _ := Read(Name, 0, r.Offset, true)
	if len(r2.Entries) != 1 || r2.Entries[0].Msg != "neu" || r2.Reset {
		t.Fatalf("live: %+v", r2)
	}
	// alerts count warnings and errors since a sequence number
	a := Alerts(0)
	if a.Warnings != 1 || a.Errors != 1 {
		t.Errorf("Alerts: %+v", a)
	}
	if b := Alerts(a.Seq); b.Warnings+b.Errors != 0 {
		t.Errorf("nach „gesehen“ nichts Neues: %+v", b)
	}
	if c := Alerts(a.Seq + 99); c.Warnings != 1 { // restarted: counts from the start again
		t.Errorf("Neustart: %+v", c)
	}
	// clear keeps the file open and usable
	if err := Clear(Name); err != nil {
		t.Fatal(err)
	}
	l.Infof("nach dem Leeren")
	r3, _ := Read(Name, 1000, 0, false)
	if len(r3.Entries) != 1 || r3.Entries[0].Msg != "nach dem Leeren" {
		t.Errorf("nach Clear: %+v", r3)
	}
	if _, err := Read("../../etc/passwd", 10, 0, false); err == nil {
		t.Error("ungültiger Dateiname muss abgelehnt werden")
	}
}

func TestRotationAndMemoryMode(t *testing.T) {
	cfg := t.TempDir()
	fresh(t, cfg)
	big := strings.Repeat("x", 4000)
	for i := 0; i < 700; i++ { // > 2 MB
		Get("t").Infof("%s", big)
	}
	fs := Files()
	if len(fs) < 2 {
		t.Errorf("keine Rotation: %+v", fs)
	}
	fresh(t, "") // memory only
	Get("m").Infof("eins")
	r, _ := Read(Name, 10, 0, false)
	if len(r.Entries) != 1 || r.Entries[0].Msg != "eins" {
		t.Fatalf("Speicher: %+v", r)
	}
	Get("m").Warnf("zwei")
	r2, _ := Read(Name, 10, r.Offset, true)
	if len(r2.Entries) != 1 || r2.Entries[0].Msg != "zwei" {
		t.Errorf("Speicher live: %+v", r2)
	}
}
