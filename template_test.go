package main

import (
	"encoding/xml"
	"os"
	"strings"
	"testing"
)

// Die Unraid-Vorlage muss gültiges XML sein und die GPU-Anleitung enthalten (Intel/AMD: /dev/dri, NVIDIA: --runtime=nvidia).
func TestUnraidTemplate(t *testing.T) {
	b, err := os.ReadFile("unraid/p5converter.xml")
	if err != nil {
		t.Fatal(err)
	}
	var c struct {
		Overview string `xml:"Overview"`
		Config   []struct {
			Name   string `xml:"Name,attr"`
			Target string `xml:"Target,attr"`
			Type   string `xml:"Type,attr"`
		} `xml:"Config"`
		ExtraParams string `xml:"ExtraParams"`
	}
	if err := xml.Unmarshal(b, &c); err != nil {
		t.Fatalf("XML ungültig: %v", err)
	}
	for _, w := range []string{"/dev/dri", "--runtime=nvidia", "Nvidia-Driver", "Quick Sync", "AMD"} {
		if !strings.Contains(c.Overview, w) {
			t.Errorf("Anleitung nennt %q nicht", w)
		}
	}
	if strings.Contains(c.ExtraParams, "nvidia") {
		t.Error("--runtime=nvidia darf nicht vorausgefüllt sein (Container startet sonst ohne Plugin nicht)")
	}
	dri := false
	for _, x := range c.Config {
		if x.Type == "Device" && strings.Contains(x.Name, "dri") {
			dri = true
		}
	}
	if !dri {
		t.Error("Gerät /dev/dri fehlt")
	}
}
