// Package auth implements the optional login: one user name and password, created in the browser.
//
//   - auth.json (in the config folder) holds the user name and the password HASH (PBKDF2-SHA256 with its own salt),
//     never the password.
//   - A session is a random token in a cookie (HttpOnly, SameSite=Lax); the server stores only its SHA-256 and the
//     expiry (sessions.json), so a copy of that file cannot be used to log in.
//   - Wrong attempts are slowed down per IP and per user name.
//   - Forgotten password (needs access to the server): `p5converter auth reset`, the environment variable
//     P5_AUTH_RESET=1 at start, or delete auth.json.
package auth

import (
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	pbkdf2Iter   = 600_000
	rememberLife = 30 * 24 * time.Hour
	sessionLife  = 24 * time.Hour
	MinPassword  = 8
	freeAttempts = 5
	maxBlock     = 15 * time.Minute
	firstBlock   = 30 * time.Second
	cookieName   = "p5c_session"
)

// Iter is the PBKDF2 cost for NEW hashes (tests lower it; stored hashes carry their own value).
var Iter = 600_000

var (
	ErrInvalid    = errors.New("Benutzername oder Passwort falsch")
	ErrNoStorage  = errors.New("Kein dauerhafter Speicher: bitte den Pfad /config einhängen, sonst geht die Anmeldung beim Neustart verloren")
	ErrAlreadyOn  = errors.New("Die Anmeldung ist schon eingeschaltet")
	ErrNotEnabled = errors.New("Die Anmeldung ist nicht eingeschaltet")
)

// BlockedError says how long the caller has to wait.
type BlockedError struct{ Wait time.Duration }

func (e *BlockedError) Error() string {
	return fmt.Sprintf("Zu viele Fehlversuche – bitte in %d Sekunden erneut versuchen", int(e.Wait.Seconds())+1)
}

func CookieName() string { return cookieName }

type authFile struct {
	User    string `json:"user"`
	Hash    string `json:"hash"`
	Fun     bool   `json:"fun"`
	Created int64  `json:"created"`
}

type fail struct {
	n     int
	until time.Time
}

type Manager struct {
	dir      string
	mu       sync.Mutex
	f        *authFile
	sessions map[string]time.Time // sha256(token) -> expiry
	fails    map[string]*fail
	dummy    string
	now      func() time.Time
}

func New(dir string) *Manager {
	m := &Manager{dir: dir, sessions: map[string]time.Time{}, fails: map[string]*fail{}, now: time.Now}
	m.dummy = hashPassword("dummy-password-for-timing")
	m.reload()
	return m
}

func (m *Manager) path(n string) string { return filepath.Join(m.dir, n) }

// reload re-reads the files (so deleting auth.json switches the login off immediately).
func (m *Manager) reload() {
	m.f = nil
	if m.dir == "" {
		return
	}
	if b, err := os.ReadFile(m.path("auth.json")); err == nil {
		var f authFile
		if json.Unmarshal(b, &f) == nil && f.User != "" && f.Hash != "" {
			m.f = &f
		}
	}
	m.sessions = map[string]time.Time{}
	if b, err := os.ReadFile(m.path("sessions.json")); err == nil {
		var s map[string]int64
		if json.Unmarshal(b, &s) == nil {
			for k, v := range s {
				if t := time.Unix(v, 0); t.After(m.now()) {
					m.sessions[k] = t
				}
			}
		}
	}
}

func (m *Manager) writePrivate(name string, v any) error {
	if m.dir == "" {
		return ErrNoStorage
	}
	if err := os.MkdirAll(m.dir, 0o755); err != nil {
		return ErrNoStorage
	}
	b, _ := json.MarshalIndent(v, "", "  ")
	tmp := m.path(name + ".tmp")
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return ErrNoStorage
	}
	return os.Rename(tmp, m.path(name))
}

func (m *Manager) saveSessions() {
	s := map[string]int64{}
	for k, v := range m.sessions {
		if v.After(m.now()) {
			s[k] = v.Unix()
		}
	}
	m.writePrivate("sessions.json", s)
}

// currentFile re-checks auth.json on disk (cheap) so a reset by deleting the file is honoured at once.
func (m *Manager) check() {
	if m.dir == "" {
		return
	}
	_, err := os.Stat(m.path("auth.json"))
	if err != nil && m.f != nil {
		m.f = nil
		m.sessions = map[string]time.Time{}
	}
	if err == nil && m.f == nil {
		m.reload()
	}
}

func (m *Manager) Enabled() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.check()
	return m.f != nil
}

func (m *Manager) User() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.check()
	if m.f == nil {
		return ""
	}
	return m.f.User
}

func (m *Manager) Fun() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.check()
	return m.f == nil || m.f.Fun
}

// ---- password hashing ----

func hashPassword(pw string) string {
	salt := make([]byte, 16)
	rand.Read(salt)
	key, _ := pbkdf2.Key(sha256.New, pw, salt, Iter, 32)
	return fmt.Sprintf("pbkdf2-sha256$%d$%s$%s", Iter, base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key))
}

func verifyPassword(pw, stored string) bool {
	p := strings.Split(stored, "$")
	if len(p) != 4 || p[0] != "pbkdf2-sha256" {
		return false
	}
	iter, err := strconv.Atoi(p[1])
	if err != nil || iter < 1000 {
		return false
	}
	salt, err1 := base64.RawStdEncoding.DecodeString(p[2])
	want, err2 := base64.RawStdEncoding.DecodeString(p[3])
	if err1 != nil || err2 != nil {
		return false
	}
	key, err := pbkdf2.Key(sha256.New, pw, salt, iter, len(want))
	return err == nil && subtle.ConstantTimeCompare(key, want) == 1
}

func checkNew(user, pw string) (string, error) {
	user = strings.TrimSpace(user)
	if n := len([]rune(user)); n < 1 || n > 40 {
		return "", errors.New("Benutzername: 1–40 Zeichen")
	}
	if len([]rune(pw)) < MinPassword {
		return "", fmt.Errorf("Das Passwort braucht mindestens %d Zeichen", MinPassword)
	}
	if len(pw) > 200 {
		return "", errors.New("Passwort zu lang")
	}
	return user, nil
}

// ---- rate limiting ----

func (m *Manager) blockedFor(keys []string) time.Duration {
	var wait time.Duration
	for _, k := range keys {
		if f := m.fails[k]; f != nil && f.until.After(m.now()) {
			if d := f.until.Sub(m.now()); d > wait {
				wait = d
			}
		}
	}
	return wait
}

func (m *Manager) failed(keys []string) {
	for _, k := range keys {
		f := m.fails[k]
		if f == nil {
			f = &fail{}
			m.fails[k] = f
		}
		f.n++
		if f.n > freeAttempts {
			d := firstBlock << (f.n - freeAttempts - 1)
			if d > maxBlock || d <= 0 {
				d = maxBlock
			}
			f.until = m.now().Add(d)
		}
	}
}

func (m *Manager) cleared(keys []string) {
	for _, k := range keys {
		delete(m.fails, k)
	}
}

// ---- operations ----

func (m *Manager) Setup(user, pw string) error {
	user, err := checkNew(user, pw)
	if err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.check()
	if m.f != nil {
		return ErrAlreadyOn
	}
	f := &authFile{User: user, Hash: hashPassword(pw), Fun: true, Created: m.now().Unix()}
	if err := m.writePrivate("auth.json", f); err != nil {
		return err
	}
	m.f = f
	return nil
}

func newToken() (token, stored string) {
	b := make([]byte, 32)
	rand.Read(b)
	token = hex.EncodeToString(b)
	return token, tokHash(token)
}

func tokHash(t string) string {
	h := sha256.Sum256([]byte(t))
	return hex.EncodeToString(h[:])
}

// Login checks the credentials and returns a session token and its lifetime in seconds.
func (m *Manager) Login(user, pw, ip string, remember bool) (string, int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.check()
	if m.f == nil {
		return "", 0, ErrNotEnabled
	}
	keys := []string{"ip:" + ip, "user:" + strings.ToLower(strings.TrimSpace(user))}
	if w := m.blockedFor(keys); w > 0 {
		return "", 0, &BlockedError{w}
	}
	userOK := subtle.ConstantTimeCompare([]byte(strings.TrimSpace(user)), []byte(m.f.User)) == 1
	stored := m.dummy
	if userOK {
		stored = m.f.Hash
	}
	// always hash once, so timing does not reveal whether the user exists
	pwOK := verifyPassword(pw, stored)
	if !userOK || !pwOK {
		m.failed(keys)
		return "", 0, ErrInvalid
	}
	m.cleared(keys)
	life := sessionLife
	if remember {
		life = rememberLife
	}
	tok, h := newToken()
	m.sessions[h] = m.now().Add(life)
	m.saveSessions()
	return tok, int(life.Seconds()), nil
}

func (m *Manager) Valid(token string) bool {
	if token == "" {
		return false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.check()
	exp, ok := m.sessions[tokHash(token)]
	return ok && exp.After(m.now())
}

func (m *Manager) Logout(token string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.sessions, tokHash(token))
	m.saveSessions()
}

// verifyCurrent checks the current password (used by change/disable).
func (m *Manager) verifyCurrent(pw string) error {
	if m.f == nil {
		return ErrNotEnabled
	}
	if !verifyPassword(pw, m.f.Hash) {
		return errors.New("Das aktuelle Passwort stimmt nicht")
	}
	return nil
}

// Change sets a new user name and/or password; needs the current password. All sessions end.
func (m *Manager) Change(current, newUser, newPW string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.check()
	if err := m.verifyCurrent(current); err != nil {
		return err
	}
	user, pw := m.f.User, ""
	if strings.TrimSpace(newUser) != "" {
		user = newUser
	}
	if newPW != "" {
		pw = newPW
	}
	f := *m.f
	if pw != "" {
		u, err := checkNew(user, pw)
		if err != nil {
			return err
		}
		f.User, f.Hash = u, hashPassword(pw)
	} else {
		u, err := checkNew(user, "xxxxxxxx")
		if err != nil {
			return err
		}
		f.User = u
	}
	if err := m.writePrivate("auth.json", &f); err != nil {
		return err
	}
	m.f = &f
	m.sessions = map[string]time.Time{}
	m.saveSessions()
	return nil
}

func (m *Manager) SetFun(on bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.check()
	if m.f == nil {
		return ErrNotEnabled
	}
	f := *m.f
	f.Fun = on
	if err := m.writePrivate("auth.json", &f); err != nil {
		return err
	}
	m.f = &f
	return nil
}

// Disable switches the login off (needs the current password).
func (m *Manager) Disable(pw string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.check()
	if err := m.verifyCurrent(pw); err != nil {
		return err
	}
	return m.resetLocked()
}

func (m *Manager) resetLocked() error {
	m.f = nil
	m.sessions = map[string]time.Time{}
	if m.dir != "" {
		os.Remove(m.path("auth.json"))
		os.Remove(m.path("sessions.json"))
	}
	return nil
}

// Reset removes the login without a password (server access required: CLI or P5_AUTH_RESET).
func Reset(dir string) error {
	if dir == "" {
		return errors.New("kein Konfigurationsordner (P5_CONFIG) angegeben")
	}
	for _, n := range []string{"auth.json", "sessions.json"} {
		if err := os.Remove(filepath.Join(dir, n)); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}
