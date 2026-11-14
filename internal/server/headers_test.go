package server

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSecurityHeaders(t *testing.T) {
	_, ts := newTestServer(t, nil)
	for _, path := range []string{"/", "/api/info"} {
		resp, err := http.Get(ts.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if got := resp.Header.Get("X-Content-Type-Options"); got != "nosniff" {
			t.Errorf("%s: X-Content-Type-Options = %q", path, got)
		}
		if got := resp.Header.Get("X-Frame-Options"); got != "DENY" {
			t.Errorf("%s: X-Frame-Options = %q", path, got)
		}
		if got := resp.Header.Get("Referrer-Policy"); got != "no-referrer" {
			t.Errorf("%s: Referrer-Policy = %q", path, got)
		}
		for _, h := range []string{"Cross-Origin-Opener-Policy", "Cross-Origin-Resource-Policy"} {
			if got := resp.Header.Get(h); got != "same-origin" {
				t.Errorf("%s: %s = %q", path, h, got)
			}
		}
		if got := resp.Header.Get("Permissions-Policy"); !strings.Contains(got, "camera=()") || !strings.Contains(got, "microphone=()") {
			t.Errorf("%s: Permissions-Policy = %q", path, got)
		}
		if got := resp.Header.Get("Strict-Transport-Security"); got != "" {
			t.Errorf("%s: HSTS ohne TLS = %q", path, got)
		}
		csp := resp.Header.Get("Content-Security-Policy")
		for _, want := range []string{"default-src 'self'", "script-src 'self'", "img-src 'self' data: blob:", "media-src 'self' blob:",
			"object-src 'none'", "frame-src 'none'", "form-action 'self'", "frame-ancestors 'none'", "base-uri 'none'", "style-src 'self';"} {
			if !strings.Contains(csp, want) {
				t.Errorf("%s: CSP ohne %q: %s", path, want, csp)
			}
		}
		if strings.Contains(csp, "unsafe-") {
			t.Errorf("%s: CSP erlaubt unsichere Quellen: %s", path, csp)
		}
	}
}

// Ein übergroßer Auftrag wird abgewiesen, statt den Speicher zu füllen.
func TestSubmitBodyLimit(t *testing.T) {
	_, ts := newTestServer(t, nil)
	body := append([]byte(`{"kind":"video","items":[`), bytes.Repeat([]byte(" "), maxJobBody+1)...)
	req, _ := http.NewRequest("POST", ts.URL+"/api/jobs", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("Status %d, erwartet 400", resp.StatusCode)
	}
}

// HSTS darf nur gesetzt werden, wenn die Verbindung verschluesselt ist (direkt oder hinter einem TLS-Proxy).
func TestHSTSOnlyWhenEncrypted(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	for _, tc := range []struct {
		name, proto string
		want        bool
	}{{"direkt HTTP", "", false}, {"Proxy HTTPS", "https", true}} {
		req := httptest.NewRequest("GET", "/", nil)
		if tc.proto != "" {
			req.Header.Set("X-Forwarded-Proto", tc.proto)
		}
		rr := httptest.NewRecorder()
		securityHeaders(next).ServeHTTP(rr, req)
		got := rr.Header().Get("Strict-Transport-Security")
		if tc.want && got == "" {
			t.Errorf("%s: HSTS fehlt", tc.name)
		}
		if !tc.want && got != "" {
			t.Errorf("%s: HSTS unerwartet: %q", tc.name, got)
		}
	}
}
