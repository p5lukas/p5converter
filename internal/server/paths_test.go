package server

import (
	"os"
	"path/filepath"
	"testing"
)

// Ein Symlink innerhalb einer Freigabe darf sie nicht nach außen verlängern.
func TestAllowedResolvesSymlinks(t *testing.T) {
	base := t.TempDir()
	root, outside := filepath.Join(base, "video1"), filepath.Join(base, "outside")
	for _, d := range []string{root, outside} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(outside, "secret.mkv"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	inside := filepath.Join(root, "echt")
	if err := os.MkdirAll(inside, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "raus")); err != nil {
		t.Skipf("Symlinks nicht verfügbar: %v", err)
	}
	if err := os.Symlink(inside, filepath.Join(root, "rein")); err != nil {
		t.Fatal(err)
	}
	s := &Server{Roots: []string{root}}

	if s.allowed(filepath.Join(root, "raus", "secret.mkv")) {
		t.Error("Symlink nach außen muss abgelehnt werden")
	}
	if s.allowed(filepath.Join(root, "raus")) {
		t.Error("Symlink-Ordner nach außen muss abgelehnt werden")
	}
	if !s.allowed(filepath.Join(root, "rein", "folge.mkv")) {
		t.Error("Symlink innerhalb der Freigabe bleibt erlaubt")
	}
	if !s.allowed(filepath.Join(root, "neu", "folge.mkv")) {
		t.Error("noch nicht angelegter Zielordner unter der Freigabe muss erlaubt bleiben")
	}
	if s.allowed(filepath.Join(outside, "secret.mkv")) {
		t.Error("Pfad außerhalb der Freigabe")
	}
}

// Ist die Freigabe selbst ein Symlink (z. B. /video1 → /mnt/user/filme), bleibt sie nutzbar.
func TestAllowedRootIsSymlink(t *testing.T) {
	base := t.TempDir()
	real := filepath.Join(base, "filme")
	if err := os.MkdirAll(real, 0o755); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(base, "video1")
	if err := os.Symlink(real, link); err != nil {
		t.Skipf("Symlinks nicht verfügbar: %v", err)
	}
	s := &Server{Roots: []string{link}}
	if !s.allowed(filepath.Join(link, "film.mkv")) || !s.allowed(filepath.Join(real, "film.mkv")) {
		t.Error("Freigabe über Symlink muss beide Schreibweisen erlauben")
	}
}
