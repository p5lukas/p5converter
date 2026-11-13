package server

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strconv"
	"strings"

	"github.com/p5lukas/p5converter/internal/auth"
	"github.com/p5lukas/p5converter/internal/logs"
)

// -------------------------------------------------------------------- auth ---

func (s *Server) sessionToken(r *http.Request) string {
	if c, err := r.Cookie(auth.CookieName()); err == nil {
		return c.Value
	}
	return ""
}

// authGuard protects the API when the login is on. The static page, the manifest and the login calls stay public.
func (s *Server) authGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		public := !strings.HasPrefix(p, "/api/") || p == "/api/auth/state" || p == "/api/auth/login" ||
			p == "/api/auth/setup" || p == "/api/auth/logout"
		if !public && s.Auth.Enabled() && !s.Auth.Valid(s.sessionToken(r)) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(map[string]any{"error": "Anmeldung erforderlich", "login": true})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) authStateOf(r *http.Request) map[string]any {
	return s.authStateTok(s.sessionToken(r))
}

func (s *Server) authStateTok(token string) map[string]any {
	enabled := s.Auth.Enabled()
	ok := !enabled || s.Auth.Valid(token)
	st := map[string]any{"enabled": enabled, "authenticated": ok, "fun": s.Auth.Fun(), "persistent": s.Settings.Persistent()}
	if enabled && ok {
		st["user"] = s.Auth.User()
	}
	return st
}

func (s *Server) authState(w http.ResponseWriter, r *http.Request) { writeJSON(w, s.authStateOf(r)) }

func clientIP(r *http.Request) string {
	h, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return h
}

func setSessionCookie(w http.ResponseWriter, r *http.Request, token string, maxAge int, remember bool) {
	c := &http.Cookie{Name: auth.CookieName(), Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode,
		Secure: r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"}
	if remember {
		c.MaxAge = maxAge
	}
	http.SetCookie(w, c)
}

func (s *Server) authLogin(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Remember bool   `json:"remember"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&b) != nil {
		httpErr(w, 400, "Ungültige Anfrage")
		return
	}
	tok, life, err := s.Auth.Login(b.Username, b.Password, clientIP(r), b.Remember)
	if err != nil {
		var be *auth.BlockedError
		if errors.As(err, &be) {
			logs.Get("auth").Warnf("Anmeldung gesperrt für %s (zu viele Fehlversuche, %d s)", clientIP(r), int(be.Wait.Seconds())+1)
		} else if !errors.Is(err, auth.ErrNotEnabled) {
			logs.Get("auth").Warnf("Anmeldung fehlgeschlagen für Benutzer %q von %s", b.Username, clientIP(r))
		}
		switch {
		case errors.As(err, &be):
			w.Header().Set("Retry-After", strconv.Itoa(int(be.Wait.Seconds())+1))
			httpErr(w, 429, err.Error())
		case errors.Is(err, auth.ErrNotEnabled):
			httpErr(w, 400, err.Error())
		default:
			httpErr(w, 401, err.Error())
		}
		return
	}
	logs.Get("auth").Infof("Angemeldet: %q von %s", b.Username, clientIP(r))
	setSessionCookie(w, r, tok, life, b.Remember)
	writeJSON(w, map[string]any{"ok": true, "state": map[string]any{"enabled": true, "authenticated": true, "user": s.Auth.User(), "fun": s.Auth.Fun()}})
}

func (s *Server) authLogout(w http.ResponseWriter, r *http.Request) {
	if t := s.sessionToken(r); t != "" {
		s.Auth.Logout(t)
	}
	http.SetCookie(w, &http.Cookie{Name: auth.CookieName(), Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode})
	writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) authSetup(w http.ResponseWriter, r *http.Request) {
	var b struct{ Username, Password string }
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&b) != nil {
		httpErr(w, 400, "Ungültige Anfrage")
		return
	}
	if err := s.Auth.Setup(b.Username, b.Password); err != nil {
		httpErr(w, 400, err.Error())
		return
	}
	logs.Get("auth").Infof("Anmeldung eingeschaltet (Benutzer %q)", b.Username)
	// log the person in right away, otherwise they would lock themselves out of the page they are on
	tok := ""
	if t, life, err := s.Auth.Login(b.Username, b.Password, clientIP(r), false); err == nil {
		tok = t
		setSessionCookie(w, r, tok, life, false)
	}
	writeJSON(w, s.authStateTok(tok))
}

func (s *Server) authChange(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Current     string `json:"current"`
		Username    string `json:"username"`
		NewPassword string `json:"newPassword"`
		Fun         *bool  `json:"fun"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&b) != nil {
		httpErr(w, 400, "Ungültige Anfrage")
		return
	}
	if b.Fun != nil && b.Current == "" && b.Username == "" && b.NewPassword == "" { // the fun switch needs no password
		if err := s.Auth.SetFun(*b.Fun); err != nil {
			httpErr(w, 400, err.Error())
			return
		}
		writeJSON(w, s.authStateOf(r))
		return
	}
	if err := s.Auth.Change(b.Current, b.Username, b.NewPassword); err != nil {
		logs.Get("auth").Warnf("Zugangsdaten ändern abgelehnt: %v", err)
		httpErr(w, 400, err.Error())
		return
	}
	logs.Get("auth").Infof("Zugangsdaten geändert, alle Sitzungen beendet")
	// all sessions ended: sign this browser in again with the new data
	user := b.Username
	if strings.TrimSpace(user) == "" {
		user = s.Auth.User()
	}
	pw := b.NewPassword
	if pw == "" {
		pw = b.Current
	}
	tok := ""
	if t, life, err := s.Auth.Login(user, pw, clientIP(r), false); err == nil {
		tok = t
		setSessionCookie(w, r, tok, life, false)
	}
	writeJSON(w, s.authStateTok(tok))
}

func (s *Server) authDisable(w http.ResponseWriter, r *http.Request) {
	var b struct{ Password string }
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&b) != nil {
		httpErr(w, 400, "Ungültige Anfrage")
		return
	}
	if err := s.Auth.Disable(b.Password); err != nil {
		logs.Get("auth").Warnf("Anmeldung ausschalten abgelehnt: %v", err)
		httpErr(w, 400, err.Error())
		return
	}
	logs.Get("auth").Infof("Anmeldung ausgeschaltet")
	http.SetCookie(w, &http.Cookie{Name: auth.CookieName(), Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode})
	writeJSON(w, s.authStateOf(r))
}

// useDetected übernimmt aus der Hardware-Erkennung, was ein Auftrag braucht: die Geräteoptionen des Encoders (z. B. Quick Sync über ein VAAPI-Gerät) und
// für Quick Sync (Windows) den beim Test gefundenen Lese-Adapter; klappt dort kein Weg zum Hardware-Lesen, liest gleich die CPU (statt zweier Fehlversuche je Datei).
