package jobs

import (
	"path/filepath"
	"testing"

	"github.com/p5lukas/p5converter/internal/ffmpeg"
	"github.com/p5lukas/p5converter/internal/hw"
)

func queueTestManager(t *testing.T) *Manager {
	t.Helper()
	m := New(ffmpeg.Tools{}, hw.NewSampler(), 1)
	m.Pause(true) // nothing is started: the tests only look at order and bookkeeping
	return m
}

func submitN(m *Manager, kind string, names ...string) []string {
	var ids []string
	for _, n := range names {
		ids = append(ids, m.Submit(&Request{Kind: kind, Items: []Item{{Path: "/in/" + n}}, Output: OutputOpts{Dir: "/out"}})...)
	}
	return ids
}

func order(m *Manager, kind string) []string {
	var out []string
	for _, j := range m.Snapshot() {
		if j.Kind == kind && j.Status == "queued" {
			out = append(out, j.Name)
		}
	}
	return out
}

func TestMoveUpDownTop(t *testing.T) {
	m := queueTestManager(t)
	ids := submitN(m, "video", "a.mkv", "b.mkv", "c.mkv", "d.mkv")
	audio := submitN(m, "audio", "x.mp3")
	if !m.Move(ids[2], "up") {
		t.Fatal("up")
	}
	if got := order(m, "video"); got[1] != "c.mkv" || got[2] != "b.mkv" {
		t.Fatalf("up: %v", got)
	}
	if !m.Move(ids[3], "top") || order(m, "video")[0] != "d.mkv" {
		t.Fatalf("top: %v", order(m, "video"))
	}
	if !m.Move(ids[3], "down") || order(m, "video")[1] != "d.mkv" {
		t.Fatalf("down: %v", order(m, "video"))
	}
	if m.Move(ids[3], "top") == false || m.Move(ids[3], "top") {
		t.Error("ein Auftrag an erster Stelle lässt sich nicht weiter nach oben schieben")
	}
	if m.Move(audio[0], "down") {
		t.Error("Audio kennt nur seinen eigenen Platz: einziger Auftrag kann nicht nach unten")
	}
	if m.Move(ids[0], "sideways") || m.Move("nope", "up") {
		t.Error("ungültige Eingaben müssen abgelehnt werden")
	}
	want := []string{"d.mkv", "a.mkv", "c.mkv", "b.mkv"}
	for i, n := range order(m, "video") {
		if n != want[i] {
			t.Errorf("Reihenfolge %v, erwartet %v", order(m, "video"), want)
			break
		}
	}
}

func TestHoldAndPause(t *testing.T) {
	m := queueTestManager(t)
	ids := submitN(m, "video", "a.mkv", "b.mkv")
	m.Hold(ids[0], true)
	held := 0
	for _, j := range m.Snapshot() {
		if j.Held {
			held++
		}
	}
	if held != 1 || !m.Paused() {
		t.Fatalf("held=%d paused=%v", held, m.Paused())
	}
	m.Hold(ids[0], false)
	for _, j := range m.Snapshot() {
		if j.Held {
			t.Error("Haltepunkt nicht aufgehoben")
		}
	}
	m.CancelAll("")
}

func TestQueueSurvivesRestart(t *testing.T) {
	file := filepath.Join(t.TempDir(), "queue.json")
	m := queueTestManager(t)
	m.SetQueueFile(file)
	submitN(m, "video", "a.mkv", "b.mkv")
	submitN(m, "audio", "x.mp3")
	// „Neustart“: ein neuer Manager liest die Datei; die Aufträge warten auf die Entscheidung und starten nicht von selbst
	m2 := queueTestManager(t)
	if n := m2.SetQueueFile(file); n != 3 {
		t.Fatalf("erwartet 3 wartende Aufträge, %d", n)
	}
	if r := m2.Restorable(); r["count"] != 3 || r["video"] != 2 || r["audio"] != 1 {
		t.Fatalf("Restorable: %v", r)
	}
	if len(m2.Snapshot()) != 0 {
		t.Error("vor der Entscheidung darf nichts in der Warteschlange stehen")
	}
	// bis zur Entscheidung bleiben sie in der Datei, auch wenn schon etwas Neues dazukommt
	submitN(m2, "video", "neu.mkv")
	m3 := queueTestManager(t)
	if n := m3.SetQueueFile(file); n != 4 {
		t.Errorf("noch nicht entschiedene Aufträge gingen verloren: %d", n)
	}
	if n := m2.Restore(); n != 3 {
		t.Fatalf("Restore: %d", n)
	}
	if got := order(m2, "video"); len(got) != 3 || got[0] != "neu.mkv" {
		t.Errorf("nach dem Fortsetzen: %v", got)
	}
	if m2.Restorable()["count"] != 0 {
		t.Error("nach dem Fortsetzen darf nichts mehr wartend sein")
	}
	m2.DiscardRestorable()
	// alles abbrechen: danach ist die Datei leer bzw. weg
	m2.CancelAll("")
	m4 := queueTestManager(t)
	for i := 0; i < 50 && m4.SetQueueFile(file) != 0; i++ {
		m4 = queueTestManager(t)
	}
}
