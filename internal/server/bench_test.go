package server

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/p5lukas/p5converter/internal/hw"
)

func TestBenchVariantsAndFastest(t *testing.T) {
	res := hw.Result{Done: true, Backends: []hw.Backend{
		{ID: "nvenc", Codecs: map[string]bool{"h264": true, "hevc": true, "av1": false}},
		{ID: "cpu", Codecs: map[string]bool{"h264": true, "hevc": true, "av1": true, "vp9": true}},
	}}
	vs := benchVariants(res)
	var ids []string
	for _, v := range vs {
		ids = append(ids, v.b.ID+"-"+v.codec)
	}
	if got := len(vs); got != 5 || ids[0] != "cpu-h264" || ids[3] != "nvenc-h264" { // CPU zuerst; vp9 und nicht funktionierendes AV1 fehlen
		t.Errorf("Varianten: %v", ids)
	}
	for _, v := range vs {
		if v.crf <= 0 {
			t.Errorf("ohne Qualitätszahl: %+v", v)
		}
	}
	rs := []*BenchResult{{ID: "cpu-h264", Codec: "h264", Status: "fertig", Speed: 9}, {ID: "cpu-hevc", Codec: "hevc", Status: "fertig", Speed: 2},
		{ID: "nvenc-hevc", Codec: "hevc", Status: "fertig", Speed: 7}, {ID: "nvenc-h264", Codec: "h264", Status: "fehler", Speed: 50}}
	if got := benchFastest(rs); got != "nvenc-hevc" { // H.265 hat Vorrang, fehlerhafte zählen nicht
		t.Errorf("schnellster: %s", got)
	}
	if got := benchFastest([]*BenchResult{{ID: "a", Codec: "h264", Status: "fertig", Speed: 3}}); got != "a" {
		t.Errorf("ohne H.265 gewinnt der schnellste: %s", got)
	}
	if got := benchFastest([]*BenchResult{{ID: "a", Status: "fehler"}}); got != "" {
		t.Errorf("nichts fertig: %q", got)
	}
	if benchFingerprint(res) == benchFingerprint(hw.Result{Backends: res.Backends[:1]}) {
		t.Error("andere Hardware muss einen anderen Fingerabdruck ergeben")
	}
}

// Der Schnelltest läuft mit den echten CPU-Encodern (ffmpeg aus dem PATH): fertige Ergebnisse mit Größe und Geschwindigkeit, gemerkt für die erkannte Hardware.
func TestBenchRunsWithCPU(t *testing.T) {
	s, ts := newTestServer(t, nil)
	s.Det.Detect()
	var st struct{ ID string }
	r := post(t, ts, "/api/bench/start", map[string]any{"seconds": 2}, nil)
	if r.StatusCode != 200 {
		t.Fatalf("Start: %d", r.StatusCode)
	}
	getJSON(t, ts, "/api/bench/last", &struct{}{})
	var started map[string]string
	json.NewDecoder(r.Body).Decode(&started)
	st.ID = started["id"]
	var run BenchRun
	deadline := time.Now().Add(120 * time.Second)
	for time.Now().Before(deadline) {
		getJSON(t, ts, "/api/bench/"+st.ID, &run)
		if run.Status != "läuft" {
			break
		}
		time.Sleep(300 * time.Millisecond)
	}
	if run.Status != "fertig" {
		t.Fatalf("Status %q %s", run.Status, run.Error)
	}
	done := 0
	for _, x := range run.Results {
		if x.Status == "fertig" {
			done++
			if x.Size <= 0 || x.Speed <= 0 || x.FPS <= 0 || x.Kbps <= 0 || x.Encoder == "" {
				t.Errorf("unvollständiges Ergebnis: %+v", x)
			}
		}
	}
	if done == 0 || run.Fastest == "" {
		t.Fatalf("kein fertiges Ergebnis: %+v", run.Results)
	}
	var last struct{ Last *BenchRun }
	getJSON(t, ts, "/api/bench/last", &last)
	if last.Last == nil || last.Last.ID != run.ID || last.Last.Fastest != run.Fastest {
		t.Errorf("gemerktes Ergebnis fehlt: %+v", last.Last)
	}
}

// Es läuft immer nur ein Schnelltest; er lässt sich abbrechen. (Dass er bei laufenden Aufträgen nicht startet, prüft die Oberfläche-Prüfung.)
func TestBenchOnlyOneAtATime(t *testing.T) {
	s, ts := newTestServer(t, nil)
	s.Det.Detect()
	r := post(t, ts, "/api/bench/start", map[string]any{"seconds": 2}, nil)
	if r.StatusCode != 200 {
		t.Fatalf("Start ohne Aufträge: %d", r.StatusCode)
	}
	var started map[string]string
	json.NewDecoder(r.Body).Decode(&started)
	if r2 := post(t, ts, "/api/bench/start", map[string]any{"seconds": 2}, nil); r2.StatusCode != 409 {
		t.Errorf("zweiter Start während des Laufs: %d, erwartet 409", r2.StatusCode)
	}
	post(t, ts, "/api/bench/"+started["id"]+"/cancel", map[string]any{}, nil)
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		var run BenchRun
		getJSON(t, ts, "/api/bench/"+started["id"], &run)
		if run.Status != "läuft" {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Error("der abgebrochene Schnelltest endet nicht")
}
