package hw

import (
	"reflect"
	"strings"
	"testing"
)

func TestQSVVariantsIncludeVaapiChild(t *testing.T) {
	v := qsvVariantsFor("linux", []string{"/dev/dri/renderD128", "/dev/dri/renderD129"})
	if len(v) != 4 || v[0].init != nil || v[1].name != "qsv=hw" {
		t.Fatalf("Varianten: %+v", v)
	}
	want := []string{"-init_hw_device", "vaapi=va:/dev/dri/renderD129", "-init_hw_device", "qsv=hw@va"}
	if !reflect.DeepEqual(v[3].init, want) {
		t.Errorf("init = %v", v[3].init)
	}
	if len(qsvVariantsFor("linux", nil)) != 2 {
		t.Error("ohne Render-Knoten nur die beiden einfachen Varianten")
	}
	// Windows: zusätzlich Direct3D 11 und DXVA2 (kein VAAPI-Gerät)
	w := qsvVariantsFor("windows", nil)
	if len(w) != 4 || !strings.Contains(strings.Join(w[2].init, " "), "d3d11va") || !strings.Contains(strings.Join(w[3].init, " "), "dxva2") {
		t.Errorf("Windows-Varianten: %+v", w)
	}
}

func TestQSVHintAndFriendly(t *testing.T) {
	h := qsvHint("[av1_qsv] Error creating a MFX session: -9.")
	if !strings.Contains(h, "Media-SDK") || !strings.Contains(h, "VAAPI") {
		t.Errorf("Hinweis: %s", h)
	}
	if !strings.Contains(qsvHint(""), "/dev/dri") {
		t.Error("leerer Fehler -> Hinweis auf /dev/dri")
	}
	if !strings.Contains(qsvHint("x: Permission denied"), "verweigert") {
		t.Error("Rechte")
	}
	if strings.Contains(friendly("[h264_nvenc @ 0x55d] Cannot load libcuda.so.1"), "0x55d") {
		t.Error("Adressen müssen raus")
	}
}

func TestParseVainfo(t *testing.T) {
	text := `libva info: VA-API version 1.20.0
vainfo: Driver version: Intel iHD driver for Intel(R) Gen Graphics - 24.1.0 ()
vainfo: Supported profile and entrypoints
      VAProfileH264Main               : VAEntrypointVLD
      VAProfileH264Main               : VAEntrypointEncSliceLP
      VAProfileH264Main               : VAEntrypointEncSlice
      VAProfileHEVCMain               : VAEntrypointEncSliceLP
      VAProfileHEVCMain10             : VAEntrypointEncSliceLP
`
	v := parseVainfo("/dev/dri/renderD128", text)
	if !strings.Contains(v.Driver, "iHD") {
		t.Errorf("Treiber: %q", v.Driver)
	}
	want := []string{"H264Main (LP)", "H264Main", "HEVCMain (LP)", "HEVCMain10 (LP)"}
	if !reflect.DeepEqual(v.Encode, want) {
		t.Errorf("Profile: %v", v.Encode)
	}
}
