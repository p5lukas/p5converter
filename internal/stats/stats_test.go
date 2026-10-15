package stats

import "testing"

func TestAddPersistAndReload(t *testing.T) {
	dir := t.TempDir()
	s := Open(dir)
	s.Add("video", 1000, 400)
	s.Add("video", 500, 600) // got bigger: counted as it is
	s.Add("audio", 100, 50)
	s.Add("audio", 0, 10)  // invalid sizes are ignored
	s.Add("video", 10, -1) // ditto
	g := Open(dir).Get()   // reload from disk
	if g.Video != (Totals{Count: 2, In: 1500, Out: 1000}) || g.Audio != (Totals{Count: 1, In: 100, Out: 50}) || g.Since == "" {
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
