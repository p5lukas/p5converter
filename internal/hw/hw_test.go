package hw

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"

	"github.com/p5lukas/p5converter/internal/ffmpeg"
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

func TestResultNeverHasNullLists(t *testing.T) {
	b, err := json.Marshal(NewDetector(ffmpeg.Tools{}).Result())
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), "null") {
		t.Errorf("vor der ersten Erkennung darf kein null im JSON stehen: %s", b)
	}
}

func TestNvencOldDriverIsExplained(t *testing.T) {
	raw := "[av1_nvenc @ 000001812205ea00] Driver does not support the required nvenc API version. Required: 13.1 Found: 12.0 | [av1_nvenc @ 000001812205ea00] The minimum required Nvidia driver for nvenc is 610.00 or newer | Error while opening encoder"
	d := failDetail("nvenc", raw)
	for _, w := range []string{"zu alt", "12.0", "13.1", "610", "aktualisieren"} {
		if !strings.Contains(d, w) {
			t.Errorf("Hinweis nennt %q nicht: %s", w, d)
		}
	}
	if d := failDetail("nvenc", "Cannot load nvcuda.dll"); !strings.Contains(d, "Keine NVIDIA") {
		t.Errorf("ohne Treiber: %s", d)
	}
	if d := failDetail("amf", "x"); !strings.HasPrefix(d, "kein Gerät/Treiber nutzbar") {
		t.Errorf("andere Backends unverändert: %s", d)
	}
}

func TestQSVDecodeVariantsOnlyOnWindows(t *testing.T) {
	if len(qsvDecodeVariantsFor("linux")) != 0 || len(qsvDecodeVariantsFor("darwin")) != 0 {
		t.Error("Lese-Test nur unter Windows")
	}
	v := qsvDecodeVariantsFor("windows")
	if len(v) != 5 || v[0].init != nil || !strings.Contains(strings.Join(v[1].init, " "), "child_device=0") || !strings.Contains(strings.Join(v[4].init, " "), "child_device=3,child_device_type=d3d11va") {
		t.Fatalf("Windows: Standard-Adapter, dann Adapter 0 bis 3: %+v", v)
	}
	a := strings.Join(qsvDecodeArgs(v[2].init), " ")
	if !strings.Contains(a, "child_device=1") || !strings.HasSuffix(a, "-hwaccel qsv -hwaccel_output_format qsv -hwaccel_device hw") {
		t.Errorf("Argumente: %s", a)
	}
	if got := strings.Join(qsvDecodeArgs(nil), " "); got != "-hwaccel qsv -hwaccel_output_format qsv" {
		t.Errorf("ohne Gerät: %s", got)
	}
}

func TestMaybePresent(t *testing.T) {
	gpus := []string{"NVIDIA GeForce RTX 3050", "Intel(R) UHD Graphics 770"}
	for backend, want := range map[string]bool{"qsv": true, "nvenc": true, "amf": false, "vaapi": true, "unbekannt": true} {
		if got := MaybePresent(gpus, backend); got != want {
			t.Errorf("%s: %v, erwartet %v", backend, got, want)
		}
	}
	if !MaybePresent(nil, "amf") {
		t.Error("ohne Grafikliste (z. B. Container) darf nichts ausgeschlossen werden")
	}
	if !MaybePresent([]string{"AMD Radeon RX 6600"}, "amf") || MaybePresent([]string{"AMD Radeon RX 6600"}, "nvenc") {
		t.Error("AMD-Karte: AMF ja, NVENC nein")
	}
}

// Ein ffmpeg-Ersatz, der das Lesen mit Quick Sync nur über Adapter 1 zulässt (wie ein PC mit NVIDIA als Adapter 0 und Intel als Adapter 1).
func fakeFFmpeg(t *testing.T, okAdapter string) *Detector {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("Shell-Skript")
	}
	dir := t.TempDir()
	script := `#!/bin/sh
last=""
for a in "$@"; do last="$a"; done
case "$*" in
  *libx264*) : > "$last"; exit 0 ;;
  *hwaccel*) case "$*" in *"` + okAdapter + `"*) exit 0 ;; esac; echo "[vist#0:0/h264 @ 0x1] Hardware device setup failed for decoder: Unknown error occurred"; exit 1 ;;
esac
exit 0
`
	p := filepath.Join(dir, "ffmpeg")
	if err := os.WriteFile(p, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return NewDetector(ffmpeg.Tools{FFmpeg: p})
}

func TestDetectQSVDecodePicksWorkingAdapter(t *testing.T) {
	d := fakeFFmpeg(t, "child_device=1,")
	var diag []DiagLine
	b := &Backend{ID: "qsv"}
	d.detectQSVDecodeFor("windows", b, map[string]bool{"libx264": true}, func(l DiagLine) { diag = append(diag, l) })
	if !b.DecodeTested || !b.DecodeOK || b.DecodeVariant != "Direct3D-11-Adapter 1" || !strings.Contains(strings.Join(b.DecodeInit, " "), "child_device=1") {
		t.Fatalf("Ergebnis: %+v", b)
	}
	// Standard-Adapter und Adapter 0 scheiterten, Adapter 1 klappte: drei Diagnosezeilen, die letzte ok, mit der Fehlermeldung bei den ersten
	if len(diag) != 3 || diag[0].OK || diag[1].OK || !diag[2].OK || diag[0].Codec != "Lesen" || !strings.Contains(diag[0].Msg, "Hardware device setup failed") {
		t.Errorf("Diagnose: %+v", diag)
	}
	// klappt schon der Standard-Adapter, bleibt DecodeInit leer (Verhalten wie bisher)
	d2 := fakeFFmpeg(t, "-hwaccel_output_format")
	b2 := &Backend{ID: "qsv"}
	d2.detectQSVDecodeFor("windows", b2, map[string]bool{"libx264": true}, func(DiagLine) {})
	if !b2.DecodeOK || b2.DecodeVariant != "Standard-Adapter" || len(b2.DecodeInit) != 0 {
		t.Errorf("Standard-Adapter: %+v", b2)
	}
}

func TestDetectQSVDecodeNoWayAndOtherSystems(t *testing.T) {
	d := fakeFFmpeg(t, "gibt-es-nicht")
	b := &Backend{ID: "qsv"}
	n := 0
	d.detectQSVDecodeFor("windows", b, map[string]bool{"libx264": true}, func(DiagLine) { n++ })
	if !b.DecodeTested || b.DecodeOK || n != 5 {
		t.Errorf("kein Weg: %+v, %d Tests", b, n)
	}
	// Linux/macOS und fehlendes libx264: nicht getestet, nichts ändert sich
	for name, c := range map[string]struct {
		goos string
		enc  map[string]bool
	}{"linux": {"linux", map[string]bool{"libx264": true}}, "ohne libx264": {"windows", map[string]bool{}}} {
		b := &Backend{ID: "qsv"}
		d.detectQSVDecodeFor(c.goos, b, c.enc, func(DiagLine) { t.Errorf("%s: kein Test erwartet", name) })
		if b.DecodeTested {
			t.Errorf("%s: darf nicht als getestet gelten", name)
		}
	}
}
