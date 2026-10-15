package auth

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func init() { Iter = 1000 }

func TestSetupLoginSessionLogout(t *testing.T) {
	dir := t.TempDir()
	m := New(dir)
	if m.Enabled() {
		t.Fatal("anfangs aus")
	}
	if err := m.Setup("lukas", "kurz"); err == nil {
		t.Error("zu kurzes Passwort muss abgelehnt werden")
	}
	if err := m.Setup("lukas", "geheimes-passwort"); err != nil {
		t.Fatal(err)
	}
	if err := m.Setup("x", "geheimes-passwort"); !errors.Is(err, ErrAlreadyOn) {
		t.Errorf("zweites Setup: %v", err)
	}
	b, _ := os.ReadFile(filepath.Join(dir, "auth.json"))
	if string(b) == "" || contains(string(b), "geheimes-passwort") {
		t.Error("Passwort steht im Klartext in auth.json")
	}
	if _, _, err := m.Login("lukas", "falsch", "1.2.3.4", false); !errors.Is(err, ErrInvalid) {
		t.Errorf("falsches Passwort: %v", err)
	}
	tok, life, err := m.Login("lukas", "geheimes-passwort", "1.2.3.4", true)
	if err != nil || life != int(rememberLife.Seconds()) {
		t.Fatalf("Login: %v %d", err, life)
	}
	if !m.Valid(tok) || m.Valid("quatsch") || m.Valid("") {
		t.Error("Sitzungsprüfung")
	}
	sess, _ := os.ReadFile(filepath.Join(dir, "sessions.json"))
	if contains(string(sess), tok) {
		t.Error("Token steht im Klartext in sessions.json")
	}
	// survives a restart
	m2 := New(dir)
	if !m2.Enabled() || !m2.Valid(tok) {
		t.Error("nach Neustart weg")
	}
	m2.Logout(tok)
	if m2.Valid(tok) {
		t.Error("Logout")
	}
}

func contains(s, sub string) bool {
	return len(sub) > 0 && len(s) >= len(sub) && (func() bool { return indexOf(s, sub) >= 0 })()
}
func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

func TestRateLimit(t *testing.T) {
	m := New(t.TempDir())
	m.Setup("lukas", "geheimes-passwort")
	now := time.Now()
	m.now = func() time.Time { return now }
	for i := 0; i < freeAttempts; i++ {
		if _, _, err := m.Login("lukas", "falsch", "9.9.9.9", false); !errors.Is(err, ErrInvalid) {
			t.Fatalf("Versuch %d: %v", i, err)
		}
	}
	// 6th failure triggers the block
	m.Login("lukas", "falsch", "9.9.9.9", false)
	_, _, err := m.Login("lukas", "geheimes-passwort", "9.9.9.9", false) // even the right password is blocked now
	var be *BlockedError
	if !errors.As(err, &be) || be.Wait < 29*time.Second || be.Wait > 31*time.Second {
		t.Fatalf("erwartet 30 s Sperre, bekam %v", err)
	}
	// other IP, same user name: also blocked (per user name)
	if _, _, err := m.Login("lukas", "geheimes-passwort", "8.8.8.8", false); !errors.As(err, &be) {
		t.Errorf("Sperre pro Benutzername: %v", err)
	}
	now = now.Add(31 * time.Second)
	if _, _, err := m.Login("lukas", "geheimes-passwort", "9.9.9.9", false); err != nil {
		t.Errorf("nach Ablauf muss es gehen: %v", err)
	}
}

func TestChangeDisableResetAndFileDeletion(t *testing.T) {
	dir := t.TempDir()
	m := New(dir)
	m.Setup("lukas", "geheimes-passwort")
	tok, _, _ := m.Login("lukas", "geheimes-passwort", "ip", false)
	if err := m.Change("falsch", "", "neues-passwort-123"); err == nil {
		t.Error("Ändern braucht das aktuelle Passwort")
	}
	if err := m.Change("geheimes-passwort", "", "neues-passwort-123"); err != nil {
		t.Fatal(err)
	}
	if m.Valid(tok) {
		t.Error("alte Sitzungen müssen enden")
	}
	if _, _, err := m.Login("lukas", "neues-passwort-123", "ip", false); err != nil {
		t.Errorf("Login mit neuem Passwort: %v", err)
	}
	if err := m.SetFun(false); err != nil || m.Fun() {
		t.Errorf("Spaßmeldung abschalten: %v", err)
	}
	// deleting auth.json switches the login off at once
	os.Remove(filepath.Join(dir, "auth.json"))
	if m.Enabled() {
		t.Error("nach Löschen von auth.json muss die Anmeldung aus sein")
	}
	m.Setup("lukas", "geheimes-passwort")
	if err := m.Disable("falsch"); err == nil {
		t.Error("Ausschalten braucht das Passwort")
	}
	if err := m.Disable("geheimes-passwort"); err != nil || m.Enabled() {
		t.Errorf("Ausschalten: %v", err)
	}
	m.Setup("lukas", "geheimes-passwort")
	if err := Reset(dir); err != nil || m.Enabled() {
		t.Errorf("Reset: %v enabled=%v", err, m.Enabled())
	}
}

func TestNoStorage(t *testing.T) {
	if err := New("").Setup("lukas", "geheimes-passwort"); !errors.Is(err, ErrNoStorage) {
		t.Errorf("ohne /config darf die Anmeldung nicht eingeschaltet werden: %v", err)
	}
}
