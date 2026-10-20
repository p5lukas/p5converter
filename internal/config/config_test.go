package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDefaultsPersistAndReload(t *testing.T) {
	dir := t.TempDir()
	st := Open(dir)
	if !st.Persistent() || st.Existed() {
		t.Fatalf("persistent=%v existed=%v", st.Persistent(), st.Existed())
	}
	s := st.Get()
	if len(s.Presets) != 2 || !s.HWDecode || len(s.TrackRules.Audio) != 0 {
		t.Fatalf("Standardwerte: %+v", s)
	}
	s.DefaultOutDir = "/output"
	s.TrackRules.Audio = append(s.TrackRules.Audio, AudioRule{Codec: "dts", Ch: "any", Action: "encode", To: "eac3", Kbps: 256})
	s.Presets = append(s.Presets, Preset{Name: "Meins", World: "video", Suggest: true, Values: map[string]any{"vCodec": "hevc", "vCrf": 19.0, "vQuality": "good", "evil": "x"}})
	if _, err := st.Put(s); err != nil {
		t.Fatal(err)
	}
	st2 := Open(dir) // reload from disk
	got := st2.Get()
	if !st2.Existed() || got.DefaultOutDir != "/output" || len(got.TrackRules.Audio) != 1 || got.TrackRules.Audio[0].To != "eac3" || got.TrackRules.Audio[0].Kbps != 256 {
		t.Errorf("nicht gespeichert: %+v", got)
	}
	last := got.Presets[len(got.Presets)-1]
	if last.Name != "Meins" || last.ID == "" || last.Values["vCrf"] != 19.0 || last.Values["vQuality"] != "good" {
		t.Errorf("Preset: %+v", last)
	}
	if _, bad := last.Values["evil"]; bad {
		t.Error("unbekanntes Feld wurde nicht entfernt")
	}
}

func TestValidateRejects(t *testing.T) {
	base := Defaults()
	cases := map[string]func(s *Settings){
		"regel codec": func(s *Settings) { s.TrackRules.Audio = []AudioRule{{Codec: "xyz", Action: "drop"}} },
		"regel ziel":  func(s *Settings) { s.TrackRules.Audio = []AudioRule{{Codec: "dts", Action: "encode", To: "wav"}} },
		"regel kbps": func(s *Settings) {
			s.TrackRules.Audio = []AudioRule{{Codec: "dts", Action: "encode", To: "ac3", Kbps: 900}}
		},
		"regel sub":   func(s *Settings) { s.TrackRules.Sub = []SubRule{{Kind: "image", Action: "encode"}} },
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

func TestVerifyDefaults(t *testing.T) {
	// Einstellungen aus der Zeit vor 0.1.4 haben kein "verify": A und B an
	out, err := Validate(Settings{PreferredBackend: "auto"})
	if err != nil {
		t.Fatal(err)
	}
	for _, w := range []string{"audio", "video"} {
		if v := out.Verify[w]; !v.Tracks || !v.Decode {
			t.Errorf("%s: unerwartete Standardwerte %+v", w, v)
		}
	}
	// Welten bleiben getrennt
	ok := Defaults()
	ok.Presets = nil
	ok.Verify["audio"] = Verify{Decode: true}
	got, err := Validate(ok)
	if err != nil || got.Verify["audio"].Tracks || !got.Verify["video"].Tracks {
		t.Errorf("Welten müssen getrennt bleiben: %+v %v", got.Verify, err)
	}
}

// Alte settings.json mit den Schonfrist-Feldern aus 0.1.4 lässt sich weiter laden (Felder werden ignoriert).
func TestOldGraceFieldsIgnored(t *testing.T) {
	var s Settings
	if err := json.Unmarshal([]byte(`{"verify":{"audio":{"tracks":true,"decode":false,"grace":true,"graceDays":30}}}`), &s); err != nil {
		t.Fatal(err)
	}
	if !s.Verify["audio"].Tracks || s.Verify["audio"].Decode {
		t.Errorf("%+v", s.Verify)
	}
}

func TestTrackPrefsCleanedAndLimited(t *testing.T) {
	in := Defaults()
	in.Presets = nil
	in.TrackPrefs = TrackPrefs{AudioKeep: []string{"GER", " eng ", "ger"}, AudioDefault: []string{"ger", "eng"}, SubDefault: []SubPref{{"ger", true}, {"GER", true}, {"ger", false}}}
	out, err := Validate(in)
	if err != nil {
		t.Fatal(err)
	}
	tp := out.TrackPrefs
	if len(tp.AudioKeep) != 2 || tp.AudioKeep[0] != "ger" || tp.AudioKeep[1] != "eng" || len(tp.SubDefault) != 2 || tp.SubKeep == nil {
		t.Errorf("Wünsche nicht bereinigt: %+v", tp)
	}
	bad := Defaults()
	bad.Presets = nil
	bad.TrackPrefs.AudioKeep = []string{"deutsch1"}
	if _, err := Validate(bad); err == nil {
		t.Error("ungültiger Sprachcode muss abgelehnt werden")
	}
	// das Vorkommen in Voreinstellungen: Codec-Regeln sind ein erlaubtes Feld
	p := Defaults()
	p.Presets = []Preset{{ID: "x", Name: "R", World: "video", Values: map[string]any{"vTrkRules": `{"audio":[]}`, "bogus": "x"}}}
	got, err := Validate(p)
	if err != nil || got.Presets[0].Values["vTrkRules"] == nil || got.Presets[0].Values["bogus"] != nil {
		t.Errorf("vTrkRules muss in Voreinstellungen erlaubt sein: %+v %v", got.Presets, err)
	}
}

func TestRootNames(t *testing.T) {
	dir := t.TempDir()
	st := Open(dir)
	s := st.Get()
	s.RootNames = map[string]string{"/video1": "  Filme 4K ", "/video2": "", "": "x", "/audio1": "Musik"}
	if _, err := st.Put(s); err != nil {
		t.Fatal(err)
	}
	got := Open(dir).Get().RootNames
	if len(got) != 2 || got["/video1"] != "Filme 4K" || got["/audio1"] != "Musik" {
		t.Errorf("Anzeigenamen: %v", got)
	}
	s.RootNames = map[string]string{"/video1": strings.Repeat("x", 41)}
	if _, err := st.Put(s); err == nil {
		t.Error("zu langer Name wurde akzeptiert")
	}
}

// Regeln: leere Felder bekommen Standardwerte, bei „kopieren/entfernen“ bleibt kein Ziel stehen; alte Einstellungen mit Welten-Feldern laden weiter.
func TestTrackRulesCleaned(t *testing.T) {
	out, err := Validate(Settings{PreferredBackend: "auto",
		TrackRules: TrackRules{Audio: []AudioRule{{Action: "drop", To: "ac3", Kbps: 200}, {Codec: "truehd", Action: "encode", To: "ac3"}}, Sub: []SubRule{{Action: "drop"}}}})
	if err != nil {
		t.Fatal(err)
	}
	a := out.TrackRules.Audio
	if a[0].Codec != "any" || a[0].Ch != "any" || a[0].To != "" || a[0].Kbps != 0 || a[1].Kbps != 0 || out.TrackRules.Sub[0].Kind != "any" {
		t.Errorf("Regeln: %+v", out.TrackRules)
	}
	var old Settings
	if err := json.Unmarshal([]byte(`{"worlds":{"audio":{"name":"x","hue":140}},"worldOrder":["video","audio"],"startWorld":"video","noCrfSuggest":true,"preferredBackend":"auto"}`), &old); err != nil {
		t.Fatal(err)
	}
	if _, err := Validate(old); err != nil {
		t.Errorf("alte Einstellungen müssen ladbar bleiben: %v", err)
	}
	if out.TrackRules.Audio == nil {
		t.Error("nil-Liste")
	}
}

// Frische Einstellungen schicken leere Listen statt null (die Oberfläche ruft .slice() darauf auf).
func TestDefaultsHaveNoNullLists(t *testing.T) {
	b, _ := json.Marshal(Open(t.TempDir()).Get())
	for _, k := range []string{`"audioKeep":null`, `"subKeep":null`, `"audioDefault":null`, `"subDefault":null`, `"trackRules":{"audio":null`} {
		if strings.Contains(string(b), k) {
			t.Errorf("null statt leerer Liste: %s", k)
		}
	}
}
