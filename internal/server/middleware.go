package server

import (
	"net/http"
	"net/url"
	"strings"
)

// securityHeaders setzt die Header, die für eine reine Same-Origin-Oberfläche ohne Inline-Scripts reichen:
// die Oberfläche lädt nichts von außen, deshalb darf die CSP streng sein.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		h.Set("Cross-Origin-Resource-Policy", "same-origin")
		h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()")
		h.Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; "+
			"img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; "+
			"object-src 'none'; frame-src 'none'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
		// HSTS nur, wenn die Verbindung wirklich verschluesselt ist (der Container selbst hoert meist nur HTTP).
		if r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
			h.Set("Strict-Transport-Security", "max-age=31536000")
		}
		next.ServeHTTP(w, r)
	})
}

// csrfGuard blocks cross-site requests: state-changing calls must be JSON (forces a CORS
// preflight we never answer) and, if an Origin header is present, must come from this host.
func csrfGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
				httpErr(w, 415, "Content-Type application/json erforderlich")
				return
			}
		}
		if o := r.Header.Get("Origin"); o != "" {
			u, err := url.Parse(o)
			if err != nil || u.Host != r.Host {
				httpErr(w, 403, "Cross-Origin-Anfrage abgelehnt")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
