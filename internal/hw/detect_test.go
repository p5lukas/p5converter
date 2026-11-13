package hw

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/p5lukas/p5converter/internal/ffmpeg"
)

func detectFake(t *testing.T, script string) ffmpeg.Tools {
	t.Helper()
	if _, err := os.Stat("/bin/sh"); err != nil {
		t.Skip("keine Shell")
	}
	p := filepath.Join(t.TempDir(), "ffmpeg")
	if err := os.WriteFile(p, []byte("#!/bin/sh\n"+script), 0o755); err != nil {
		t.Fatal(err)
	}
	return ffmpeg.Tools{FFmpeg: p}
}

const encoderList = ` V..... libx264              H.264
 V..... libx265              H.265
 V..... libsvtav1            AV1
 V..... h264_qsv             H.264 QSV
 V..... hevc_qsv             H.265 QSV
 V..... h264_nvenc           H.264 NVENC
 V..... hevc_nvenc           H.265 NVENC
 V..... h264_vaapi           H.264 VAAPI
 V..... h264_amf             H.264 AMF
`

func backend(t *testing.T, r Result, id string) Backend {
	t.Helper()
	for _, b := range r.Backends {
		if b.ID == id {
			return b
		}
	}
	t.Fatalf("Backend %q fehlt: %+v", id, r.Backends)
	return Backend{}
}

// Ohne passende Hardware bleibt die Erkennung ruhig: CPU kann alles, die GPU-Backends haben einen
// Klartext-Grund statt eines Fehlers, und nichts wird als nutzbar gemeldet.
func TestDetectWithoutHardware(t *testing.T) {
	script := `case "$*" in
  *-encoders*) cat <<'EOF'
` + encoderList + `EOF
    exit 0;;
esac
case "$*" in
  *h264_qsv*|*hevc_qsv*) echo "[h264_qsv @ 0x55d] Error creating a MFX session: -9." >&2;;
  *nvenc*) echo "[h264_nvenc @ 0x55d] Cannot load libcuda.so.1" >&2;;
  *vaapi*) echo "Failed to initialise VAAPI connection: -1 (unknown libva error)." >&2;;
  *amf*) echo "AMF failed" >&2;;
  *) echo "boom" >&2;;
esac
exit 1
`
	d := NewDetector(detectFake(t, script))
	d.Detect()
	r := d.Result()
	if !r.Done {
		t.Fatal("Erkennung nicht abgeschlossen")
	}
	cpu := backend(t, r, "cpu")
	for _, c := range []string{"h264", "hevc", "av1"} {
		if !cpu.Codecs[c] || !cpu.TenBit[c] {
			t.Errorf("CPU kann %s nicht: %+v", c, cpu)
		}
	}
	qsv := backend(t, r, "qsv")
	if !qsv.Compiled || len(qsv.Codecs) != 0 {
		t.Errorf("QSV darf ohne Hardware nichts können: %+v", qsv)
	}
	if !strings.Contains(qsv.Detail, "Quick Sync konnte nicht gestartet werden") || !strings.Contains(qsv.Detail, "Media-SDK") {
		t.Errorf("QSV-Hinweis: %q", qsv.Detail)
	}
	nv := backend(t, r, "nvenc")
	if !nv.Compiled || len(nv.Codecs) != 0 || !strings.Contains(nv.Detail, "Keine NVIDIA-Grafikkarte") {
		t.Errorf("NVENC: %+v", nv)
	}
	// Adressen aus ffmpeg-Meldungen gehören nicht in die Diagnose
	if len(r.Diag) == 0 {
		t.Fatal("Diagnose ist leer")
	}
	for _, l := range r.Diag {
		if l.OK {
			t.Errorf("nichts darf als nutzbar gelten: %+v", l)
		}
		if strings.Contains(l.Msg, "0x55d") {
			t.Errorf("Speicheradresse nicht entfernt: %q", l.Msg)
		}
	}
}

// Klappt Quick Sync, werden die Codecs einzeln geprüft und 10 Bit nur gemeldet, wenn es wirklich geht.
func TestDetectQSVCodecs(t *testing.T) {
	script := `case "$*" in
  *-encoders*) cat <<'EOF'
` + encoderList + `EOF
    exit 0;;
esac
case "$*" in
  *"-c:v h264_qsv"*|*"-c:v hevc_qsv"*)
    case "$*" in *p010le*) echo "10 bit not supported" >&2; exit 1;; esac
    exit 0;;
esac
echo "nicht verfügbar" >&2
exit 1
`
	d := NewDetector(detectFake(t, script))
	d.Detect()
	r := d.Result()
	qsv := backend(t, r, "qsv")
	if qsv.Variant == "" {
		t.Fatalf("Startvariante nicht erkannt: %+v", qsv)
	}
	if !qsv.Codecs["h264"] || !qsv.Codecs["hevc"] {
		t.Errorf("8-Bit-Codecs fehlen: %+v", qsv.Codecs)
	}
	if qsv.TenBit["hevc"] {
		t.Error("10 Bit wurde nie erfolgreich getestet")
	}
	found := false
	for _, l := range r.Diag {
		if l.Backend == "qsv" && l.Ten && !l.OK {
			found = true
		}
	}
	if !found {
		t.Error("gescheiterter 10-Bit-Test fehlt in der Diagnose")
	}
}
