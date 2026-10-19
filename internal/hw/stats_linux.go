package hw

import (
	"github.com/p5lukas/p5converter/internal/proc"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type samplerState struct {
	cpuTotal, cpuIdle uint64
	rc6               map[string]rc6Sample
	lastSeen          bool
}

type rc6Sample struct {
	idleMs uint64
	at     time.Time
}

func (s *Sampler) sample() Stats {
	out := Stats{CPU: s.cpu()}
	out.GPUs = append(out.GPUs, nvidiaStats()...)
	out.GPUs = append(out.GPUs, s.sysfsStats()...)
	return out
}

func (s *Sampler) cpu() float64 {
	b, err := os.ReadFile("/proc/stat")
	if err != nil {
		return -1
	}
	line, _, _ := strings.Cut(string(b), "\n")
	f := strings.Fields(line)
	if len(f) < 5 {
		return -1
	}
	var total, idle uint64
	for i, v := range f[1:] {
		n, _ := strconv.ParseUint(v, 10, 64)
		total += n
		if i == 3 || i == 4 {
			idle += n
		}
	}
	prevT, prevI := s.st.cpuTotal, s.st.cpuIdle
	s.st.cpuTotal, s.st.cpuIdle = total, idle
	return cpuPercent(prevT, prevI, total, idle)
}

// cpuPercent is the busy share between two /proc/stat readings (-1 = no valid interval yet).
func cpuPercent(prevTotal, prevIdle, total, idle uint64) float64 {
	if prevTotal == 0 || total <= prevTotal || idle < prevIdle {
		return -1
	}
	v := 100 * (1 - float64(idle-prevIdle)/float64(total-prevTotal))
	return math.Max(0, math.Min(100, v))
}

// rc6Busy turns the RC6 (GPU sleep) residency counter into "GPU awake %" for an interval.
// ok=false: counter went backwards or the interval was too short.
func rc6Busy(prevMs, ms uint64, elapsed time.Duration) (float64, bool) {
	if ms < prevMs || elapsed < 200*time.Millisecond {
		return 0, false
	}
	idle := float64(ms-prevMs) / float64(elapsed.Milliseconds()) * 100
	return math.Max(0, math.Min(100, 100-idle)), true
}

func nvidiaStats() []GPUStat {
	p, err := exec.LookPath("nvidia-smi")
	if err != nil {
		return nil
	}
	b, err := proc.Command(p, "--query-gpu=name,utilization.gpu,utilization.encoder,utilization.decoder",
		"--format=csv,noheader,nounits").Output()
	if err != nil {
		return nil
	}
	var o []GPUStat
	for _, l := range strings.Split(strings.TrimSpace(string(b)), "\n") {
		f := strings.Split(l, ",")
		if len(f) < 4 {
			continue
		}
		num := func(x string) float64 {
			v, err := strconv.ParseFloat(strings.TrimSpace(x), 64)
			if err != nil {
				return -1
			}
			return v
		}
		o = append(o, GPUStat{Name: strings.TrimSpace(f[0]), Kind: "nvidia", Util: num(f[1]), Encode: num(f[2]), Decode: num(f[3]), Source: "nvidia-smi"})
	}
	return o
}

// sysfsStats reads Intel (RC6 residency => "GPU awake") and AMD (gpu_busy_percent).
func (s *Sampler) sysfsStats() []GPUStat {
	if s.st.rc6 == nil {
		s.st.rc6 = map[string]rc6Sample{}
	}
	var o []GPUStat
	cards, _ := filepath.Glob("/sys/class/drm/card[0-9]")
	for _, c := range cards {
		vb, _ := os.ReadFile(c + "/device/vendor")
		vendor := strings.TrimSpace(string(vb))
		name := filepath.Base(c)
		switch vendor {
		case "0x1002":
			if b, err := os.ReadFile(c + "/device/gpu_busy_percent"); err == nil {
				v, _ := strconv.ParseFloat(strings.TrimSpace(string(b)), 64)
				o = append(o, GPUStat{Name: "AMD " + name, Kind: "amd", Util: v, Encode: -1, Decode: -1, Source: "sysfs gpu_busy_percent"})
			}
		case "0x8086":
			var file string
			for _, cand := range []string{c + "/gt/gt0/rc6_residency_ms", c + "/device/tile0/gt0/gtidle/idle_residency_ms", c + "/power/rc6_residency_ms"} {
				if _, err := os.Stat(cand); err == nil {
					file = cand
					break
				}
			}
			if file == "" {
				continue
			}
			b, err := os.ReadFile(file)
			if err != nil {
				continue
			}
			ms, _ := strconv.ParseUint(strings.TrimSpace(string(b)), 10, 64)
			now := time.Now()
			prev, ok := s.st.rc6[c]
			s.st.rc6[c] = rc6Sample{ms, now}
			if !ok || now.Sub(prev.at) < 200*time.Millisecond {
				continue
			}
			busy, valid := rc6Busy(prev.idleMs, ms, now.Sub(prev.at))
			if !valid {
				continue
			}
			o = append(o, GPUStat{Name: "Intel " + name, Kind: "intel", Util: busy, Encode: -1, Decode: -1, Source: "sysfs RC6: Intel-Grafik nicht im Ruhezustand (gesamte Grafik, nicht nur Video)"})
		}
	}
	return o
}
