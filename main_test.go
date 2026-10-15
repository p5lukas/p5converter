package main

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestExistingRoots(t *testing.T) {
	a, b := t.TempDir(), t.TempDir()
	missing := filepath.Join(a, "gibt-es-nicht")
	file := filepath.Join(a, "datei.txt")
	os.WriteFile(file, []byte("x"), 0o644)

	got := existingRoots(a + ", " + missing + "," + file + "," + b + ",")
	if want := []string{a, b}; !reflect.DeepEqual(got, want) {
		t.Errorf("existingRoots = %v, erwartet %v", got, want)
	}
	// nothing exists: keep the list (so errors stay visible)
	if got := existingRoots(missing); !reflect.DeepEqual(got, []string{missing}) {
		t.Errorf("ohne vorhandene Ordner: %v", got)
	}
	if got := existingRoots(""); len(got) != 0 {
		t.Errorf("leer: %v", got)
	}
}
