package jobs

// Queue management: change the order, put single jobs on hold, pause the whole queue, and survive a restart of the container.
// The pending jobs (queued and running ones) are kept in a small file (usually /config/queue.json); after a restart they are not started
// by themselves but offered to the user ("N Aufträge fortsetzen?"), because the result files of an interrupted run are gone.

import (
	"encoding/json"
	"os"
)

// SetQueueFile enables the pending-jobs file and loads what a previous run left in it (it waits for Restore / DiscardRestorable).
func (m *Manager) SetQueueFile(file string) (waiting int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.queueFile = file
	if file == "" {
		return 0
	}
	if b, err := os.ReadFile(file); err == nil {
		var f queueFile
		if json.Unmarshal(b, &f) == nil {
			for _, r := range f.Jobs {
				if (r.Kind == "audio" || r.Kind == "video") && len(r.Items) == 1 {
					m.restorable = append(m.restorable, r)
				}
			}
		}
	}
	if len(m.restorable) > 0 {
		jlog.Warnf("%d Auftrag/Aufträge aus dem letzten Lauf warten auf deine Entscheidung (fortsetzen oder verwerfen)", len(m.restorable))
	}
	return len(m.restorable)
}

type queueFile struct {
	Jobs []Request `json:"jobs"`
}

// persistLocked writes the pending jobs (one request per job) plus the ones still waiting for the user's decision (caller holds m.mu).
func (m *Manager) persistLocked() {
	if m.queueFile == "" {
		return
	}
	f := queueFile{Jobs: []Request{}}
	for _, j := range m.jobs {
		if j.Status == "queued" || j.Status == "running" {
			r := *j.req
			r.Items = []Item{j.item}
			f.Jobs = append(f.Jobs, r)
		}
	}
	f.Jobs = append(f.Jobs, m.restorable...)
	if len(f.Jobs) == 0 {
		os.Remove(m.queueFile)
		return
	}
	b, err := json.Marshal(f)
	if err != nil {
		return
	}
	tmp := m.queueFile + ".tmp"
	if os.WriteFile(tmp, b, 0o644) == nil {
		os.Rename(tmp, m.queueFile)
	}
}

// Restorable tells how many interrupted jobs of a previous run wait for a decision (per kind).
func (m *Manager) Restorable() map[string]int {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := map[string]int{"count": len(m.restorable), "audio": 0, "video": 0}
	for _, r := range m.restorable {
		out[r.Kind]++
	}
	return out
}

// Restore queues the interrupted jobs again (returns their number).
func (m *Manager) Restore() int {
	m.mu.Lock()
	list := m.restorable
	m.restorable = nil
	m.mu.Unlock()
	for i := range list {
		r := list[i]
		m.Submit(&r)
	}
	m.mu.Lock()
	m.persistLocked()
	m.mu.Unlock()
	return len(list)
}

// DiscardRestorable forgets the interrupted jobs.
func (m *Manager) DiscardRestorable() {
	m.mu.Lock()
	m.restorable = nil
	m.persistLocked()
	m.mu.Unlock()
}

// Pause stops (on) or resumes (off) the whole queue: running jobs finish, but no new job starts while paused.
func (m *Manager) Pause(on bool) {
	m.mu.Lock()
	m.paused = on
	m.mu.Unlock()
	if !on {
		m.schedule()
	}
}

func (m *Manager) Paused() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.paused
}

// Hold puts a queued job on hold (on) or releases it (off); running and finished jobs are not affected.
func (m *Manager) Hold(id string, on bool) {
	m.mu.Lock()
	for _, j := range m.jobs {
		if j.ID == id && j.Status == "queued" {
			j.Held = on
		}
	}
	m.mu.Unlock()
	if !on {
		m.schedule()
	}
}

// Move changes the place of a queued job among the queued jobs of its kind: "up", "down" (one place) or "top" (first).
func (m *Manager) Move(id, how string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	from := -1
	for i, j := range m.jobs {
		if j.ID == id && j.Status == "queued" {
			from = i
		}
	}
	if from < 0 {
		return false
	}
	kind := m.jobs[from].Kind
	queued := func(i int) bool { return m.jobs[i].Status == "queued" && m.jobs[i].Kind == kind }
	to := -1
	switch how {
	case "up":
		for i := from - 1; i >= 0; i-- {
			if queued(i) {
				to = i
				break
			}
		}
	case "down":
		for i := from + 1; i < len(m.jobs); i++ {
			if queued(i) {
				to = i
				break
			}
		}
	case "top":
		for i := 0; i < from; i++ {
			if queued(i) {
				to = i
				break
			}
		}
	default:
		return false
	}
	if to < 0 {
		return false
	}
	j := m.jobs[from]
	if to < from {
		copy(m.jobs[to+1:from+1], m.jobs[to:from])
	} else {
		copy(m.jobs[from:to], m.jobs[from+1:to+1])
	}
	m.jobs[to] = j
	m.persistLocked()
	return true
}
