package jobs

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/p5lukas/p5converter/internal/ffmpeg"
	"github.com/p5lukas/p5converter/internal/proc"
)

// Check is one result of the control after a conversion (shown on the finished job).
type Check struct {
	Name string `json:"name"` // base | tracks | size | decode
	OK   bool   `json:"ok"`
	Note string `json:"note"`
}

// TrashDir is the folder (next to the source file) that holds sources during the grace period.
const TrashDir = "p5converter-gelöscht"

// expectedCounts counts the streams per type that the ffmpeg arguments map into the output
// (explicit "-map 0:N"; optional maps like attachments "0:t?" are not counted).
func expectedCounts(info *ffmpeg.Info, args []string) map[string]int {
	byIndex := map[int]string{}
	for _, s := range info.Streams {
		byIndex[s.Index] = s.Type
	}
	n := map[string]int{}
	for i := 0; i+1 < len(args); i++ {
		if args[i] != "-map" {
			continue
		}
		v := args[i+1]
		if !strings.HasPrefix(v, "0:") {
			continue
		}
		idx, err := strconv.Atoi(strings.TrimPrefix(v, "0:"))
		if err != nil {
			continue
		}
		if t, ok := byIndex[idx]; ok {
			n[t]++
		}
	}
	return n
}

func countTypes(info *ffmpeg.Info) map[string]int {
	n := map[string]int{}
	for _, s := range info.Streams {
		n[s.Type]++
	}
	return n
}

var typeLabel = map[string]string{"video": "Video", "audio": "Audio", "subtitle": "Untertitel"}

// checkTracks (A): the result has as many video/audio/subtitle streams as were selected.
func checkTracks(want map[string]int, out *ffmpeg.Info) Check {
	got := countTypes(out)
	var bad []string
	var parts []string
	for _, t := range []string{"video", "audio", "subtitle"} {
		if want[t] != got[t] {
			bad = append(bad, fmt.Sprintf("%s: %d erwartet, %d gefunden", typeLabel[t], want[t], got[t]))
		}
		if want[t] > 0 {
			parts = append(parts, fmt.Sprintf("%d× %s", got[t], typeLabel[t]))
		}
	}
	if len(bad) > 0 {
		return Check{"tracks", false, "Spuren stimmen nicht: " + strings.Join(bad, ", ")}
	}
	return Check{"tracks", true, "Spuren vollständig (" + strings.Join(parts, ", ") + ")"}
}

// checkSize (A): the result must not be absurdly small compared with the source.
func checkSize(in, out int64) Check {
	if in >= 1<<20 && out*100 < in {
		return Check{"size", false, fmt.Sprintf("Ergebnis auffällig klein (%s statt %s)", humanSize(out), humanSize(in))}
	}
	return Check{"size", true, "Größe plausibel"}
}

func humanSize(n int64) string {
	switch {
	case n >= 1<<30:
		return fmt.Sprintf("%.1f GB", float64(n)/(1<<30))
	case n >= 1<<20:
		return fmt.Sprintf("%.1f MB", float64(n)/(1<<20))
	default:
		return fmt.Sprintf("%d KB", n>>10)
	}
}

// checkBase: the result can be read and has (about) the same length as the source.
func checkBase(inDur float64, out *ffmpeg.Info, perr error) Check {
	switch {
	case perr != nil:
		return Check{"base", false, "Ergebnis nicht lesbar (" + perr.Error() + ")"}
	case inDur > 0 && absf(out.Duration-inDur) > maxf(2, inDur*0.02):
		return Check{"base", false, fmt.Sprintf("Laufzeit weicht ab (%.1fs → %.1fs)", inDur, out.Duration)}
	}
	return Check{"base", true, "Lesbar, Laufzeit stimmt"}
}

// decodeArgs: ffmpeg reads the whole result (picture and sound) and throws it away; errors are printed.
func decodeArgs(out string) []string {
	return []string{"-hide_banner", "-nostdin", "-v", "error", "-progress", "pipe:1", "-nostats",
		"-i", out, "-map", "0:v?", "-map", "0:a?", "-f", "null", "-"}
}

// checkDecode (B): decodes the complete result; any error message means damaged spots.
func (m *Manager) checkDecode(ctx context.Context, j *Job, out string, duration float64) Check {
	cmd := proc.CommandContext(ctx, m.tools.FFmpeg, decodeArgs(out)...)
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()
	if err := cmd.Start(); err != nil {
		return Check{"decode", false, "Decode-Test nicht möglich (" + err.Error() + ")"}
	}
	var lines []string
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); m.readProgress(j, stdout, duration) }()
	go func() {
		defer wg.Done()
		sc := bufio.NewScanner(stderr)
		sc.Buffer(make([]byte, 64*1024), 1024*1024)
		for sc.Scan() {
			if l := strings.TrimSpace(sc.Text()); l != "" && len(lines) < 5 {
				lines = append(lines, l)
			}
		}
	}()
	wg.Wait()
	err := cmd.Wait()
	switch {
	case ctx.Err() != nil:
		return Check{"decode", false, "Decode-Test abgebrochen"}
	case len(lines) > 0:
		return Check{"decode", false, "Decode-Test: beschädigte Stellen gefunden (" + strings.Join(lines, " | ") + ")"}
	case err != nil:
		return Check{"decode", false, "Decode-Test fehlgeschlagen (" + err.Error() + ")"}
	}
	return Check{"decode", true, "Decode-Test bestanden (alles fehlerfrei gelesen)"}
}

// verify runs the checks the user selected. base always runs; tracks/size (A) and decode (B) on request.
func (m *Manager) verify(ctx context.Context, j *Job, in, outInfo *ffmpeg.Info, perr error, args []string, out string, sizeIn, sizeOut int64) []Check {
	o := j.req.Output
	var cs []Check
	cs = append(cs, checkBase(in.Duration, outInfo, perr))
	if perr != nil {
		return cs
	}
	if o.VerifyTracks {
		cs = append(cs, checkTracks(expectedCounts(in, args), outInfo), checkSize(sizeIn, sizeOut))
	}
	if o.VerifyDecode {
		m.update(j, func() { j.Phase, j.Progress, j.ETA, j.Speed = "check", 0, 0, "" })
		cs = append(cs, m.checkDecode(ctx, j, out, outInfo.Duration))
	}
	return cs
}

func allOK(cs []Check) bool {
	for _, c := range cs {
		if !c.OK {
			return false
		}
	}
	return true
}

// ---- grace period: the source is moved into TrashDir and removed for good after N days ----

func clampDays(d int) int {
	if d < 1 {
		return 7
	}
	if d > 90 {
		return 90
	}
	return d
}

// trashSource moves src into <its folder>/TrashDir and remembers when to remove it.
func (m *Manager) trashSource(src string, days int) (string, error) {
	m.mu.Lock()
	tracked := m.graceFile != ""
	m.mu.Unlock()
	if !tracked {
		return "", fmt.Errorf("ohne beschreibbaren Konfigurationsordner (/config) kann die Schonfrist nicht verwaltet werden")
	}
	dir := filepath.Join(filepath.Dir(src), TrashDir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	dst := filepath.Join(dir, filepath.Base(src))
	ext := filepath.Ext(dst)
	base := strings.TrimSuffix(dst, ext)
	for i := 2; ; i++ {
		if _, err := os.Stat(dst); os.IsNotExist(err) {
			break
		}
		dst = fmt.Sprintf("%s (%d)%s", base, i, ext)
	}
	if err := os.Rename(src, dst); err != nil {
		return "", err
	}
	m.mu.Lock()
	if m.graceFile != "" {
		if m.grace == nil {
			m.grace = map[string]int64{}
		}
		m.grace[dst] = time.Now().Add(time.Duration(clampDays(days)) * 24 * time.Hour).Unix()
		m.saveGraceLocked()
	}
	m.mu.Unlock()
	return dst, nil
}

// SetGraceLog enables the grace period bookkeeping in file (usually /config/grace.json), reads what is
// pending from earlier runs and starts a background cleanup (now and then hourly).
func (m *Manager) SetGraceLog(file string) {
	m.mu.Lock()
	m.graceFile = file
	m.grace = map[string]int64{}
	if file != "" {
		if b, err := os.ReadFile(file); err == nil {
			json.Unmarshal(b, &m.grace)
		}
	}
	m.mu.Unlock()
	if file == "" {
		return
	}
	m.CleanGrace(time.Now())
	go func() {
		for {
			time.Sleep(time.Hour)
			m.CleanGrace(time.Now())
		}
	}()
}

// CleanGrace removes the sources whose grace period is over. Returns how many were removed.
func (m *Manager) CleanGrace(now time.Time) (removed int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for p, until := range m.grace {
		if until > now.Unix() {
			continue
		}
		if err := os.Remove(p); err == nil || os.IsNotExist(err) {
			if err == nil {
				removed++
				jlog.Infof("Schonfrist vorbei, Quelldatei endgültig gelöscht: %s", p)
			}
			os.Remove(filepath.Dir(p)) // only succeeds when the trash folder is empty
			delete(m.grace, p)
		}
	}
	m.saveGraceLocked()
	return removed
}

// GracePending: number of sources currently waiting in a trash folder.
func (m *Manager) GracePending() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.grace)
}

func (m *Manager) saveGraceLocked() {
	if m.graceFile == "" {
		return
	}
	b, _ := json.Marshal(m.grace)
	tmp := m.graceFile + ".tmp"
	if os.WriteFile(tmp, b, 0o644) == nil {
		os.Rename(tmp, m.graceFile)
	}
}
