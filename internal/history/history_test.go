package history

import (
	"fmt"
	"testing"
	"time"
)

func TestKeepsLast100PerWorld(t *testing.T) {
	s := Open(t.TempDir(), true)
	for i := 0; i < Max+20; i++ {
		s.Add(Entry{ID: fmt.Sprint(i), Kind: "video", Name: fmt.Sprintf("v%d", i), Status: "done", Ended: time.Now()})
	}
	s.Add(Entry{ID: "a", Kind: "audio", Name: "a", Status: "done"})
	v := s.List("video")
	if len(v) != Max || v[0].ID != fmt.Sprint(Max+19) || v[Max-1].ID != "20" {
		t.Fatalf("falsche Auswahl: %d Einträge, erster %s, letzter %s", len(v), v[0].ID, v[len(v)-1].ID)
	}
	if len(s.List("audio")) != 1 {
		t.Error("die Welten müssen getrennt zählen")
	}
}

func TestPersistsAndClearsOneWorld(t *testing.T) {
	dir := t.TempDir()
	s := Open(dir, true)
	s.Add(Entry{ID: "1", Kind: "audio", Name: "lied", Status: "done"})
	s.Add(Entry{ID: "2", Kind: "video", Name: "film", Status: "error", Error: "kaputt"})
	s2 := Open(dir, true) // wie nach einem Neustart
	if len(s2.List("audio")) != 1 || s2.List("video")[0].Error != "kaputt" {
		t.Fatalf("nach dem Neustart fehlen Einträge: %+v %+v", s2.List("audio"), s2.List("video"))
	}
	s2.Clear("video")
	s3 := Open(dir, true)
	if len(s3.List("video")) != 0 || len(s3.List("audio")) != 1 {
		t.Error("Leeren muss nur die gewählte Welt betreffen und gespeichert werden")
	}
}

func TestMemoryOnlyAndUnknownKind(t *testing.T) {
	s := Open("", false)
	s.Add(Entry{ID: "x", Kind: "video", Status: "done"})
	s.Add(Entry{ID: "y", Kind: "bogus", Status: "done"})
	if len(s.List("video")) != 1 || len(s.List("bogus")) != 0 || s.Persistent() {
		t.Error("ohne /config nur im Arbeitsspeicher, unbekannte Welt wird ignoriert")
	}
}

// „Alle“ mischt beide Arten, neueste zuerst; Leeren von „alle“ betrifft beide.
func TestAllKindsMergedAndCleared(t *testing.T) {
	s := Open(t.TempDir(), true)
	now := time.Now()
	s.Add(Entry{ID: "v1", Kind: "video", Status: "done", Ended: now.Add(-3 * time.Minute)})
	s.Add(Entry{ID: "a1", Kind: "audio", Status: "done", Ended: now.Add(-2 * time.Minute)})
	s.Add(Entry{ID: "v2", Kind: "video", Status: "error", Ended: now.Add(-1 * time.Minute)})
	l := s.List("all")
	if len(l) != 3 || l[0].ID != "v2" || l[1].ID != "a1" || l[2].ID != "v1" {
		t.Fatalf("Reihenfolge: %+v", l)
	}
	if len(s.List("")) != 3 {
		t.Error("leer = alle")
	}
	s.Clear("all")
	if len(s.List("all")) != 0 {
		t.Error("alle leeren")
	}
}
