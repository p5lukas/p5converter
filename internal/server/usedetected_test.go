package server

import (
	"reflect"
	"testing"

	"github.com/p5lukas/p5converter/internal/build"
	"github.com/p5lukas/p5converter/internal/hw"
)

func TestUseDetectedQSVDecode(t *testing.T) {
	enc := []string{"-init_hw_device", "qsv=hw"}
	dec := []string{"-init_hw_device", "qsv=hw:hw_any,child_device=1,child_device_type=d3d11va"}
	// Windows mit zwei Grafikeinheiten: der gefundene Lese-Adapter kommt in den Auftrag
	v := build.VideoOpts{HWDecode: true}
	useDetected(&v, hw.Backend{ID: "qsv", Init: enc, DecodeTested: true, DecodeOK: true, DecodeInit: dec})
	if !reflect.DeepEqual(v.HWInit, enc) || !reflect.DeepEqual(v.HWDecodeInit, dec) || !v.HWDecode {
		t.Errorf("mit Lese-Adapter: %+v", v)
	}
	// getestet, aber kein Weg: gleich mit der CPU lesen
	v = build.VideoOpts{HWDecode: true}
	useDetected(&v, hw.Backend{ID: "qsv", DecodeTested: true})
	if v.HWDecode || v.HWDecodeInit != nil {
		t.Errorf("kein Weg zum Hardware-Lesen: %+v", v)
	}
	// nicht getestet (Linux/Docker): wie bisher
	v = build.VideoOpts{HWDecode: true}
	useDetected(&v, hw.Backend{ID: "qsv", Init: enc})
	if !v.HWDecode || v.HWDecodeInit != nil || !reflect.DeepEqual(v.HWInit, enc) {
		t.Errorf("nicht getestet: %+v", v)
	}
	// andere Encoder bleiben unberührt
	v = build.VideoOpts{HWDecode: true}
	useDetected(&v, hw.Backend{ID: "nvenc", DecodeTested: true})
	if !v.HWDecode {
		t.Errorf("NVENC: %+v", v)
	}
}
