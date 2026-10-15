package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDefaultsPersistAndReload(t *testing.T) {
	dir := t.TempDir()
	st := Open(dir)
	if !st.Persistent() || st.Existed() {
		t.Fatalf("persistent=%v existed=%v", st.Persistent(), st.Existed())
	}
	s := st.Get()
	if len(s.Presets) < 10 || s.Worlds["video"].Hue != 270 {
		t.Fatalf("Standardwerte: %+v", s)
	}
	s.Worlds["audio"] = World{Name: "Musik", Hue: 205}
	s.Presets = append(s.Presets, Preset{Name: "Meins", World: "video", Suggest: true, Values: map[string]any{"vCodec": "hevc", "vCrf": 19.0, "evil": "x"}})
	if _, err := st.Put(s); err != nil {
		t.Fatal(err)
	}
	st2 := Open(dir) // reload from disk
	got := st2.Get()
	if !st2.Existed() || got.Worlds["audio"].Name != "Musik" || got.Worlds["audio"].Hue != 205 {
		t.Errorf("nicht gespeichert: %+v", got.Worlds)
	}
	last := got.Presets[len(got.Presets)-1]
	if last.Name != "Meins" || last.ID == "" || last.Values["vCrf"] != 19.0 {
		t.Errorf("Preset: %+v", last)
	}
	if _, bad := last.Values["evil"]; bad {
		t.Error("unbekanntes Feld wurde nicht entfernt")
	}
}

func TestValidateRejects(t *testing.T) {
	base := Defaults()
	cases := map[string]func(s *Settings){
		"hue":         func(s *Settings) { w := s.Worlds["audio"]; w.Hue = 400; s.Worlds["audio"] = w },
		"name leer":   func(s *Settings) { w := s.Worlds["audio"]; w.Name = "  "; s.Worlds["audio"] = w },
		"parallel":    func(s *Settings) { s.Concurrency = 99 },
		"preset name": func(s *Settings) { s.Presets[0].Name = "" },
		"preset welt": func(s *Settings) { s.Presets[0].World = "x" },
		"zu viele": func(s *Settings) {
			for i := 0; i < 101; i++ {
				s.Presets = append(s.Presets, s.Presets[0])
			}
		},
	}
	for name, mod := range cases {
		s := Defaults()
		_ = base
		mod(&s)
		if _, err := Validate(s); err == nil {
			t.Errorf("%s: Fehler erwartet", name)
		}
	}
}

func TestMemoryOnlyWhenNotWritable(t *testing.T) {
	f := filepath.Join(t.TempDir(), "datei")
	os.WriteFile(f, []byte("x"), 0o644)
	st := Open(filepath.Join(f, "unterordner")) // parent is a file -> cannot be created
	if st.Persistent() {
		t.Fatal("sollte nicht dauerhaft sein")
	}
	if _, err := st.Put(st.Get()); err != nil {
		t.Errorf("Speichern im Speicher muss gehen: %v", err)
	}
	if Open("").Persistent() {
		t.Error("leerer Pfad darf nicht dauerhaft sein")
	}
}

func TestDuplicateIDsGetNewOnes(t *testing.T) {
	s := Defaults()
	s.Presets = []Preset{{ID: "x", Name: "A", World: "audio"}, {ID: "x", Name: "B", World: "audio"}}
	out, err := Validate(s)
	if err != nil || out.Presets[0].ID == out.Presets[1].ID {
		t.Errorf("IDs: %v %+v", err, out.Presets)
	}
}
