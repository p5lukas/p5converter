package jobs

// Aktionen für ein ganzes Album (alle Lieder mit derselben Batch-Kennung): abbrechen, anhalten, in der Warteschlange verschieben.

// CancelBatch bricht alle Lieder eines Albums ab (wartende und laufende).
func (m *Manager) CancelBatch(batch string) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for _, j := range m.jobs {
		if batch != "" && j.Batch == batch && (j.Status == "queued" || j.Status == "running") {
			m.cancelLocked(j)
			n++
		}
	}
	return n
}

// HoldBatch hält alle wartenden Lieder eines Albums an (on) oder gibt sie frei (off); laufende und beendete bleiben unberührt.
func (m *Manager) HoldBatch(batch string, on bool) int {
	m.mu.Lock()
	n := 0
	for _, j := range m.jobs {
		if batch != "" && j.Batch == batch && j.Status == "queued" {
			j.Held = on
			n++
		}
	}
	m.mu.Unlock()
	if !on {
		m.schedule()
	}
	return n
}

// MoveBatch verschiebt ein Album als Block unter den wartenden Aufträgen seiner Art: "up"/"down" (ein Platz, ein einzelner Auftrag oder
// ein anderes Album zählt als ein Platz) oder "top" (ganz nach vorn). Die Reihenfolge der Lieder im Album bleibt.
func (m *Manager) MoveBatch(batch, how string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	kind := ""
	for _, j := range m.jobs {
		if j.Batch == batch && j.Status == "queued" {
			kind = j.Kind
			break
		}
	}
	if kind == "" || batch == "" {
		return false
	}
	// die wartenden Aufträge dieser Art in Reihenfolge, zu „Plätzen“ zusammengefasst (ein Album = ein Platz an der Stelle seines ersten Lieds)
	var slots []int // Indizes in m.jobs, an denen wartende Aufträge dieser Art stehen
	for i, j := range m.jobs {
		if j.Status == "queued" && j.Kind == kind {
			slots = append(slots, i)
		}
	}
	type unit struct{ jobs []*Job }
	var units []*unit
	pos := map[string]*unit{}
	for _, i := range slots {
		j := m.jobs[i]
		if j.Batch != "" {
			if u, ok := pos[j.Batch]; ok {
				u.jobs = append(u.jobs, j)
				continue
			}
			u := &unit{jobs: []*Job{j}}
			pos[j.Batch] = u
			units = append(units, u)
			continue
		}
		units = append(units, &unit{jobs: []*Job{j}})
	}
	from := -1
	for i, u := range units {
		if u == pos[batch] {
			from = i
		}
	}
	to := from
	switch how {
	case "up":
		to = from - 1
	case "down":
		to = from + 1
	case "top":
		to = 0
	default:
		return false
	}
	if from < 0 || to < 0 || to >= len(units) || to == from {
		return false
	}
	u := units[from]
	units = append(units[:from], units[from+1:]...)
	units = append(units[:to], append([]*unit{u}, units[to:]...)...)
	k := 0
	for _, un := range units {
		for _, j := range un.jobs {
			m.jobs[slots[k]] = j
			k++
		}
	}
	m.persistLocked()
	return true
}
