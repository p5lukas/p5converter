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
