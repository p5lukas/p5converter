// Package hw detects usable hardware encoders by actually test-encoding.
package hw

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/p5lukas/p5converter/internal/ffmpeg"
)

type Backend struct {
	ID       string          `json:"id"` // cpu qsv nvenc vaapi amf
	Label    string          `json:"label"`
	Device   string          `json:"device,omitempty"`
	GPU      string          `json:"gpu,omitempty"`
	Codecs   map[string]bool `json:"codecs"` // codec -> works (8 bit)
	TenBit   map[string]bool `json:"tenBit"` // codec -> 10 bit works
	Detail   string          `json:"detail,omitempty"`
	Compiled bool            `json:"compiled"` // encoders exist in this ffmpeg build
}

type Result struct {
	Backends []Backend `json:"backends"`
	GPUs     []string  `json:"gpus"`
	Devices  []string  `json:"renderNodes"`
	Done     bool      `json:"done"`
	TookMs   int64     `json:"tookMs"`
}

type Detector struct {
	tools ffmpeg.Tools
	mu    sync.RWMutex
	res   Result
}

func NewDetector(t ffmpeg.Tools) *Detector { return &Detector{tools: t} }

func (d *Detector) Result() Result {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return d.res
}

var codecs = []string{"h264", "hevc", "av1"}
var encNames = map[string]map[string]string{
	"qsv":   {"h264": "h264_qsv", "hevc": "hevc_qsv", "av1": "av1_qsv"},
	"nvenc": {"h264": "h264_nvenc", "hevc": "hevc_nvenc", "av1": "av1_nvenc"},
	"vaapi": {"h264": "h264_vaapi", "hevc": "hevc_vaapi", "av1": "av1_vaapi"},
	"amf":   {"h264": "h264_amf", "hevc": "hevc_amf", "av1": "av1_amf"},
}
var labels = map[string]string{
	"cpu": "CPU (Software)", "qsv": "Intel Quick Sync (QSV)", "nvenc": "NVIDIA NVENC",
	"vaapi": "VAAPI (Intel/AMD, Linux)", "amf": "AMD AMF (Windows)",
}

// Detect runs test encodes. Safe to call repeatedly.
func (d *Detector) Detect() {
	start := time.Now()
	enc := d.tools.Encoders()
	nodes := renderNodes()
	gpus := listGPUs()

	cpu := Backend{ID: "cpu", Label: labels["cpu"], Compiled: true, Codecs: map[string]bool{}, TenBit: map[string]bool{}}
	for c, e := range map[string]string{"h264": "libx264", "hevc": "libx265", "av1": "libsvtav1"} {
		if enc[e] || (c == "av1" && enc["libaom-av1"]) {
			cpu.Codecs[c] = true
			cpu.TenBit[c] = true
		}
	}
	if enc["libvpx-vp9"] {
		cpu.Codecs["vp9"] = true
		cpu.TenBit["vp9"] = true
	}

	type job struct {
		b    *Backend
		code string
		ten  bool
	}
	var backs []*Backend
	var jobs []job
	for _, id := range []string{"qsv", "nvenc", "vaapi", "amf"} {
		b := &Backend{ID: id, Label: labels[id], Codecs: map[string]bool{}, TenBit: map[string]bool{}}
		for _, c := range codecs {
			if enc[encNames[id][c]] {
				b.Compiled = true
			}
		}
		if !b.Compiled {
			b.Detail = "in diesem ffmpeg nicht enthalten"
			backs = append(backs, b)
			continue
		}
		if id == "vaapi" {
			if len(nodes) == 0 {
				b.Detail = "kein /dev/dri/renderD* gefunden"
				backs = append(backs, b)
				continue
			}
			b.Device = nodes[0]
		}
		backs = append(backs, b)
		for _, c := range codecs {
			if !enc[encNames[id][c]] {
				continue
			}
			jobs = append(jobs, job{b, c, false})
			if c != "h264" {
				jobs = append(jobs, job{b, c, true})
			}
		}
	}

	var wg sync.WaitGroup
	var mu sync.Mutex
	sem := make(chan struct{}, 3)
	errs := map[string]string{}
	for _, j := range jobs {
		wg.Add(1)
		sem <- struct{}{}
		go func(j job) {
			defer wg.Done()
			defer func() { <-sem }()
			ok, msg := d.test(j.b.ID, j.b.Device, encNames[j.b.ID][j.code], j.ten)
			mu.Lock()
			if ok {
				if j.ten {
					j.b.TenBit[j.code] = true
				} else {
					j.b.Codecs[j.code] = true
				}
			} else if !j.ten && msg != "" {
				errs[j.b.ID] = msg
			}
			mu.Unlock()
		}(j)
	}
	wg.Wait()

	res := Result{Done: true, GPUs: gpus, Devices: nodes, TookMs: time.Since(start).Milliseconds()}
	res.Backends = append(res.Backends, cpu)
	for _, b := range backs {
		if b.Compiled && len(b.Codecs) == 0 && b.Detail == "" {
			b.Detail = "kein Gerät/Treiber nutzbar: " + errs[b.ID]
		}
		if b.Device != "" && len(b.Codecs) > 0 {
			b.GPU = vendorOfNode(b.Device)
		}
		res.Backends = append(res.Backends, *b)
	}
	d.mu.Lock()
	d.res = res
	d.mu.Unlock()
}

func (d *Detector) test(backend, device, encoder string, ten bool) (bool, string) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	pix := "nv12"
	if ten {
		pix = "p010le"
	}
	args := []string{"-hide_banner", "-v", "error", "-nostdin"}
	if backend == "vaapi" {
		args = append(args, "-vaapi_device", device)
	}
	args = append(args, "-f", "lavfi", "-i", "color=c=black:s=640x360:r=25:d=0.5")
	vf := "format=" + pix
	if backend == "vaapi" {
		vf += ",hwupload"
	}
	args = append(args, "-vf", vf, "-frames:v", "5", "-c:v", encoder, "-f", "null", "-")
	out, err := exec.CommandContext(ctx, d.tools.FFmpeg, args...).CombinedOutput()
	if err != nil {
		var keep []string
		for _, l := range strings.Split(strings.TrimSpace(string(out)), "\n") {
			if l = strings.TrimSpace(l); l != "" && !strings.Contains(l, "Nothing was written") {
				keep = append(keep, l)
			}
		}
		if len(keep) > 2 {
			keep = keep[:2]
		}
		msg := friendly(strings.Join(keep, " | "))
		return false, msg
	}
	return true, ""
}

func renderNodes() []string {
	m, _ := filepath.Glob("/dev/dri/renderD*")
	sort.Strings(m)
	return m
}

func vendorOfNode(node string) string {
	b, err := os.ReadFile("/sys/class/drm/" + filepath.Base(node) + "/device/vendor")
	if err != nil {
		return ""
	}
	switch strings.TrimSpace(string(b)) {
	case "0x8086":
		return "Intel"
	case "0x10de":
		return "NVIDIA"
	case "0x1002":
		return "AMD"
	}
	return strings.TrimSpace(string(b))
}

var addrRe = regexp.MustCompile(` @ 0x[0-9a-f]+`)

// friendly shortens common ffmpeg failure output into a hint the user can act on.
func friendly(m string) string {
	switch {
	case strings.Contains(m, "libcuda") || strings.Contains(m, "CUDA_ERROR_NO_DEVICE") || strings.Contains(m, "No NVENC capable devices"):
		return "keine NVIDIA-GPU/-Treiber erreichbar (Docker: --runtime=nvidia bzw. NVIDIA-Treiber installieren)"
	case strings.Contains(m, "MFX session") || strings.Contains(m, "libvpl") || strings.Contains(m, "libmfx"):
		return "keine Intel-GPU/Quick-Sync-Treiber erreichbar (Docker: /dev/dri durchreichen)"
	case strings.Contains(m, "Permission denied"):
		return "Zugriff verweigert (Rechte auf /dev/dri bzw. Gerät prüfen)"
	case strings.Contains(m, "DLL") || strings.Contains(m, "AMF"):
		return "AMD-AMF-Treiber nicht erreichbar"
	}
	m = addrRe.ReplaceAllString(m, "")
	if len(m) > 200 {
		m = m[:200] + "…"
	}
	return m
}
