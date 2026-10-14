package hw

import (
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
	if prevT == 0 || total <= prevT {
		return -1
	}
	return 100 * (1 - float64(idle-prevI)/float64(total-prevT))
}

func nvidiaStats() []GPUStat {
	p, err := exec.LookPath("nvidia-smi")
	if err != nil {
		return nil
	}
	b, err := exec.Command(p, "--query-gpu=name,utilization.gpu,utilization.encoder,utilization.decoder",
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
			idle := float64(ms-prev.idleMs) / float64(now.Sub(prev.at).Milliseconds()) * 100
			busy := 100 - idle
			if busy < 0 {
				busy = 0
			}
			if busy > 100 {
				busy = 100
			}
			o = append(o, GPUStat{Name: "Intel " + name, Kind: "intel", Util: busy, Encode: -1, Decode: -1, Source: "sysfs RC6 (GPU aktiv = 100 − Ruhezustand)"})
		}
	}
	return o
}
