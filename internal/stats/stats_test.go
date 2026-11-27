package stats

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestAddPersistAndReload(t *testing.T) {
	dir := t.TempDir()
	s := Open(dir)
	s.Add("video", 1000, 400, 10)
	s.Add("video", 500, 600, 5) // got bigger: counted as it is
	s.Add("audio", 100, 50, 1)
	s.Add("audio", 0, 10, 1)  // invalid sizes are ignored
	s.Add("video", 10, -1, 1) // ditto
	g := Open(dir).Get()      // reload from disk
	if g.Video.Count != 2 || g.Video.In != 1500 || g.Video.Out != 1000 || g.Audio.Count != 1 || g.Audio.In != 100 || g.Audio.Out != 50 || g.Audio.Since == "" || g.Video.Since == "" {
		t.Errorf("%+v", g)
	}
	if m := Open("").Get(); m.Video.Count != 0 { // memory only works too
		t.Error("leerer Speicher")
	}
	mem := Open("")
	mem.Add("audio", 10, 5, 1)
	if mem.Get().Audio.Count != 1 {
		t.Error("ohne Pfad zählt nur der Speicher")
	}
}

// Each world counts and is reset on its own; files of 0.0.9 and older (one common date) are taken over.
func TestWorldsAreSeparate(t *testing.T) {
	dir := t.TempDir()
	s := Open(dir)
	s.Add("audio", 100, 50, 1)
	s.Add("video", 1000, 400, 1)
	s.Reset("audio")
	g := Open(dir).Get()
	if g.Audio.Count != 0 || g.Audio.Since != "" || g.Video.Count != 1 || g.Video.Since == "" {
		t.Errorf("Reset darf nur Audio leeren: %+v", g)
	}
	s.Add("audio", 10, 5, 1)
	if Open(dir).Get().Audio.Since == "" {
		t.Error("nach dem Zurücksetzen beginnt das Datum neu")
	}
	old := t.TempDir()
	os.WriteFile(filepath.Join(old, "stats.json"), []byte(`{"audio":{"count":1,"in":10,"out":5},"video":{"count":0,"in":0,"out":0},"since":"2026-10-01"}`), 0o644)
	o := Open(old).Get()
	if o.Audio.Since != "2026-10-01" || o.Video.Since != "" {
		t.Errorf("altes Format: %+v", o)
	}
}

// Monatssummen: jede fertige Umwandlung zählt im aktuellen Monat (je Art getrennt); „Zurücksetzen“ leert auch die Monate dieser Art.
func TestMonthsPerWorldAndReset(t *testing.T) {
	dir := t.TempDir()
	s := Open(dir)
	s.Add("video", 1000, 400, 60)
	s.Add("video", 500, 200, 30)
	s.Add("audio", 100, 50, 2)
	key := time.Now().Format("2006-01")
	v := s.History("video")
	if len(v) != 1 || v[0].Month != key || v[0].Count != 2 || v[0].In != 1500 || v[0].Out != 600 || v[0].Seconds != 90 {
		t.Errorf("Video-Monat: %+v", v)
	}
	if a := s.History("audio"); len(a) != 1 || a[0].Count != 1 || a[0].Seconds != 2 {
		t.Errorf("Audio-Monat: %+v", a)
	}
	if g := Open(dir).History("video"); len(g) != 1 || g[0].Count != 2 { // bleibt nach dem Neuladen
		t.Errorf("Monate nach dem Neuladen: %+v", g)
	}
	s.Reset("audio")
	if len(s.History("audio")) != 0 || len(s.History("video")) != 1 {
		t.Error("Zurücksetzen von Audio darf nur Audio leeren")
	}
}

// Die Monate werden einmal aus dem Verlauf vorbefüllt (nur erfolgreiche Einträge mit Größen); ein zweiter Aufruf ändert nichts mehr.
func TestBackfillOnce(t *testing.T) {
	dir := t.TempDir()
	s := Open(dir)
	jan, feb := time.Date(2026, 1, 15, 12, 0, 0, 0, time.Local), time.Date(2026, 2, 3, 12, 0, 0, 0, time.Local)
	past := []Past{{"video", jan, 1000, 400, 60}, {"video", jan, 500, 250, 30}, {"video", feb, 800, 700, 20}, {"audio", feb, 100, 50, 1},
		{"video", feb, 0, 10, 5}, {"video", time.Time{}, 10, 5, 1}, {"sonst", feb, 10, 5, 1}}
	if !s.Backfill(past) || s.Backfill(past) {
		t.Fatal("Vorbefüllen: einmal ja, dann nein")
	}
	v := s.History("video")
	if len(v) != 2 || v[0].Month != "2026-01" || v[0].Count != 2 || v[0].In != 1500 || v[0].Out != 650 || v[1].Month != "2026-02" || v[1].Count != 1 {
		t.Errorf("vorbefüllt: %+v", v)
	}
	if !s.Backfilled() || !Open(dir).Backfilled() {
		t.Error("die Markierung „vorbefüllt“ fehlt")
	}
	if g := s.Get(); g.Video.Count != 0 {
		t.Errorf("die Gesamtzahlen bleiben unberührt: %+v", g.Video)
	}
}

// Eine frische Installation (leerer Verlauf) bekommt durch das Vorbefüllen keine stats.json; das Merkzeichen wird erst mit dem ersten Auftrag gespeichert.
func TestBackfillWritesNothingWithoutHistory(t *testing.T) {
	dir := t.TempDir()
	s := Open(dir)
	if !s.Backfill(nil) {
		t.Fatal("Vorbefüllen")
	}
	if _, err := os.Stat(filepath.Join(dir, "stats.json")); err == nil {
		t.Error("ohne Verlauf darf keine stats.json entstehen (sonst gilt die Installation als Update)")
	}
	s.Add("video", 100, 50, 3)
	if r := Open(dir); !r.Backfilled() || len(r.History("video")) != 1 {
		t.Errorf("nach dem ersten Auftrag: vorbefüllt=%v, Monate=%v", r.Backfilled(), r.History("video"))
	}
}
