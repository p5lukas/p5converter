package jobs

import (
	"strings"
	"testing"

	"github.com/p5lukas/p5converter/internal/build"
	"github.com/p5lukas/p5converter/internal/ffmpeg"
	"github.com/p5lukas/p5converter/internal/hw"
)

func albumReq(kind string, n int, dir string) *Request {
	items := make([]Item, n)
	for i := range items {
		items[i] = Item{Path: dir + "/lied" + string(rune('a'+i)) + ".mp3"}
	}
	return &Request{Kind: kind, Items: items, Audio: build.AudioOpts{Format: "mp3", Mode: "vbr", Quality: 2}, Output: OutputOpts{Dir: dir + "/out", Exists: "rename"}}
}

func queuedNames(m *Manager) string {
	var out []string
	for _, j := range m.Snapshot() {
		if j.Status == "queued" {
			out = append(out, strings.TrimSuffix(strings.TrimPrefix(j.Name, "lied"), ".mp3"))
		}
	}
	return strings.Join(out, "")
}

// Ein Start mit mehreren Liedern ergibt ein Album: alle Lieder tragen dieselbe Kennung. Ein einzelnes Lied und Video bekommen keine.
func TestBatchIDsOnlyForAlbums(t *testing.T) {
	m := New(ffmpeg.Tools{FFmpeg: "/nonexistent", FFprobe: "/nonexistent"}, hw.NewSampler(), 1)
	m.Pause(true)
	m.Submit(albumReq("audio", 3, "/x"))
	m.Submit(albumReq("audio", 1, "/y"))
	m.Submit(albumReq("video", 2, "/z"))
	m.Submit(albumReq("audio", 2, "/w"))
	by := map[string][]string{}
	for _, j := range m.Snapshot() {
		by[j.Batch] = append(by[j.Batch], j.Name)
	}
	if len(by) != 3 || len(by[""]) != 3 { // 1 Lied + 2 Videos ohne Kennung, zwei Alben
		t.Fatalf("Gruppen: %v", by)
	}
	for b, names := range by {
		if b != "" && len(names) != 3 && len(names) != 2 {
			t.Errorf("Album %s mit %v", b, names)
		}
	}
	// vom Aufrufer mitgeschickte Kennungen zählen nicht (die Kennung vergibt der Server; der API-Handler leert sie), Neustart: die Kennung bleibt
	r := albumReq("audio", 1, "/r")
	r.Batch = "bwiederhergestellt"
	m.Submit(r)
	if got := m.Snapshot()[len(m.Snapshot())-1].Batch; got != "bwiederhergestellt" {
		t.Errorf("beim Wiederherstellen bleibt die Kennung: %q", got)
	}
}

func TestBatchCancelHoldMove(t *testing.T) {
	m := New(ffmpeg.Tools{FFmpeg: "/nonexistent", FFprobe: "/nonexistent"}, hw.NewSampler(), 1)
	m.Pause(true)
	m.Submit(albumReq("audio", 2, "/x")) // a b
	m.Submit(albumReq("audio", 1, "/y")) // a (Einzelauftrag)
	m.Submit(albumReq("audio", 3, "/z")) // a b c
	snap := m.Snapshot()
	albumX, albumZ := snap[0].Batch, snap[3].Batch
	if albumX == "" || albumZ == "" || albumX == albumZ {
		t.Fatalf("Alben: %q %q", albumX, albumZ)
	}
	if queuedNames(m) != "abaabc" {
		t.Fatalf("Ausgangsreihenfolge: %s", queuedNames(m))
	}
	if !m.MoveBatch(albumZ, "top") || queuedNames(m) != "abcaba" {
		t.Errorf("Album Z nach vorn: %s", queuedNames(m))
	}
	if !m.MoveBatch(albumZ, "down") || queuedNames(m) != "ababca" { // Z rückt hinter Album X
		t.Errorf("Album Z einen Platz nach hinten: %s", queuedNames(m))
	}
	if !m.MoveBatch(albumZ, "up") || queuedNames(m) != "abcaba" {
		t.Errorf("Album Z einen Platz nach vorn: %s", queuedNames(m))
	}
	if m.MoveBatch(albumZ, "top") || m.MoveBatch(albumZ, "up") {
		t.Error("ganz vorn lässt sich das Album nicht weiter nach vorn schieben")
	}
	// unmögliche Bewegungen
	if m.MoveBatch("", "top") || m.MoveBatch("bunbekannt", "top") || m.MoveBatch(albumZ, "quer") {
		t.Error("ungültige Verschiebungen müssen abgelehnt werden")
	}
	if m.HoldBatch(albumX, true) != 2 {
		t.Error("zwei Lieder des Albums X sollten angehalten werden")
	}
	held := 0
	for _, j := range m.Snapshot() {
		if j.Held {
			held++
			if j.Batch != albumX {
				t.Errorf("falsches Lied angehalten: %+v", j)
			}
		}
	}
	if held != 2 {
		t.Errorf("angehalten: %d", held)
	}
	if n := m.CancelBatch(albumZ); n != 3 {
		t.Errorf("Album Z abbrechen: %d", n)
	}
	left := 0
	for _, j := range m.Snapshot() {
		if j.Status == "queued" {
			left++
		}
	}
	if left != 3 { // Album X (2, angehalten) und der Einzelauftrag
		t.Errorf("übrig: %d", left)
	}
}

// Nach einem Neustart (queue.json) kommen die Lieder eines Albums mit derselben Kennung zurück und bleiben ein Album.
func TestBatchSurvivesRestart(t *testing.T) {
	file := t.TempDir() + "/queue.json"
	tools := ffmpeg.Tools{FFmpeg: "/nonexistent", FFprobe: "/nonexistent"}
	m := New(tools, hw.NewSampler(), 1)
	m.SetQueueFile(file)
	m.Pause(true)
	m.Submit(albumReq("audio", 3, "/x"))
	batch := m.Snapshot()[0].Batch
	m2 := New(tools, hw.NewSampler(), 1)
	if n := m2.SetQueueFile(file); n != 3 {
		t.Fatalf("wiederherstellbar: %d", n)
	}
	m2.Pause(true)
	m2.Restore()
	got := m2.Snapshot()
	if len(got) != 3 {
		t.Fatalf("nach dem Wiederherstellen: %d Aufträge", len(got))
	}
	for _, j := range got {
		if j.Batch == "" || j.Batch != batch {
			t.Errorf("Kennung nach dem Neustart: %q, vorher %q", j.Batch, batch)
		}
	}
}
