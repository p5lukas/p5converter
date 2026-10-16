package stats

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAddPersistAndReload(t *testing.T) {
	dir := t.TempDir()
	s := Open(dir)
	s.Add("video", 1000, 400)
	s.Add("video", 500, 600) // got bigger: counted as it is
	s.Add("audio", 100, 50)
	s.Add("audio", 0, 10)  // invalid sizes are ignored
	s.Add("video", 10, -1) // ditto
	g := Open(dir).Get()   // reload from disk
	if g.Video.Count != 2 || g.Video.In != 1500 || g.Video.Out != 1000 || g.Audio.Count != 1 || g.Audio.In != 100 || g.Audio.Out != 50 || g.Audio.Since == "" || g.Video.Since == "" {
		t.Errorf("%+v", g)
	}
	if m := Open("").Get(); m.Video.Count != 0 { // memory only works too
		t.Error("leerer Speicher")
	}
	mem := Open("")
	mem.Add("audio", 10, 5)
	if mem.Get().Audio.Count != 1 {
		t.Error("ohne Pfad zählt nur der Speicher")
	}
}

// Each world counts and is reset on its own; files of 0.0.9 and older (one common date) are taken over.
func TestWorldsAreSeparate(t *testing.T) {
	dir := t.TempDir()
	s := Open(dir)
	s.Add("audio", 100, 50)
	s.Add("video", 1000, 400)
	s.Reset("audio")
	g := Open(dir).Get()
	if g.Audio.Count != 0 || g.Audio.Since != "" || g.Video.Count != 1 || g.Video.Since == "" {
		t.Errorf("Reset darf nur Audio leeren: %+v", g)
	}
	s.Add("audio", 10, 5)
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
