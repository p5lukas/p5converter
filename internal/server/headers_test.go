package server

import (
	"bytes"
	"net/http"
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
		csp := resp.Header.Get("Content-Security-Policy")
		for _, want := range []string{"default-src 'self'", "script-src 'self'", "frame-ancestors 'none'", "base-uri 'none'"} {
			if !strings.Contains(csp, want) {
				t.Errorf("%s: CSP ohne %q: %s", path, want, csp)
			}
		}
	}
}

// Ein übergroßer Auftrag wird abgewiesen, statt den Speicher zu füllen.
func TestSubmitBodyLimit(t *testing.T) {
	_, ts := newTestServer(t, nil)
	body := append([]byte(`{"kind":"video","items":[`), bytes.Repeat([]byte(" "), 2<<20)...)
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
