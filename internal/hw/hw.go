// Package hw detects usable hardware encoders by actually test-encoding.
package hw

import (
	"context"
	"github.com/p5lukas/p5converter/internal/proc"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
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
	// Init are ffmpeg input options that were needed to make the encoder work (e.g. Quick Sync via a VAAPI device);
	// the same options are used for real conversions.
	Init    []string `json:"init,omitempty"`
	Variant string   `json:"variant,omitempty"` // human readable name of the start variant that worked
}

// DiagLine is one raw test result, shown in the "Diagnose" section of the UI.
type DiagLine struct {
	Backend string `json:"backend"`
	Codec   string `json:"codec"`
	Ten     bool   `json:"ten"`
	Variant string `json:"variant,omitempty"`
	OK      bool   `json:"ok"`
	Msg     string `json:"msg,omitempty"`
}

// Vainfo is the short summary of `vainfo` for one render node.
type Vainfo struct {
	Node   string   `json:"node"`
	Driver string   `json:"driver,omitempty"`
	Encode []string `json:"encode,omitempty"` // profiles that have an encode entry point
	Error  string   `json:"error,omitempty"`
}

type Result struct {
	Backends []Backend  `json:"backends"`
	GPUs     []string   `json:"gpus"`
	Devices  []string   `json:"renderNodes"`
	Diag     []DiagLine `json:"diag"`
	Vainfo   []Vainfo   `json:"vainfo"`
	Done     bool       `json:"done"`
	TookMs   int64      `json:"tookMs"`
}

type Detector struct {
	tools ffmpeg.Tools
	mu    sync.RWMutex
	res   Result
}

func NewDetector(t ffmpeg.Tools) *Detector { return &Detector{tools: t} }

// Result is the current result. Before the first detection has finished all lists are EMPTY (never nil): a nil slice would
// become "null" in the JSON and the UI would crash on it (the Windows app asks about a second after it starts).
func (d *Detector) Result() Result {
	d.mu.RLock()
	r := d.res
	d.mu.RUnlock()
	if r.Backends == nil {
		r.Backends = []Backend{}
	}
	if r.GPUs == nil {
		r.GPUs = []string{}
	}
	if r.Devices == nil {
		r.Devices = []string{}
	}
	if r.Diag == nil {
		r.Diag = []DiagLine{}
	}
	if r.Vainfo == nil {
		r.Vainfo = []Vainfo{}
	}
	return r
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

type variant struct {
	name string
	init []string
}

// qsvVariants lists the ways Quick Sync can be started. Older Intel chips (Gen 8-11) use the Media SDK runtime,
// newer ones (Gen 12+) oneVPL; which one finds the GPU can depend on how the device is opened, so several are tried.
func qsvVariants(nodes []string) []variant { return qsvVariantsFor(runtime.GOOS, nodes) }

func qsvVariantsFor(goos string, nodes []string) []variant {
	v := []variant{{"automatisch", nil}, {"qsv=hw", []string{"-init_hw_device", "qsv=hw"}}}
	if goos == "windows" { // Windows: Quick Sync läuft über Direct3D 11 (neuere Chips) oder DXVA2 (ältere)
		v = append(v, variant{"über Direct3D 11", []string{"-init_hw_device", "qsv=hw:hw_any,child_device_type=d3d11va"}},
			variant{"über DXVA2", []string{"-init_hw_device", "qsv=hw:hw_any,child_device_type=dxva2"}})
	}
	for _, n := range nodes {
		v = append(v, variant{"über VAAPI-Gerät " + n, []string{"-init_hw_device", "vaapi=va:" + n, "-init_hw_device", "qsv=hw@va"}})
	}
	return v
}

// Detect runs test encodes. Safe to call repeatedly.
func (d *Detector) Detect() {
	start := time.Now()
	enc := d.tools.Encoders()
	nodes := renderNodes()
	gpus := listGPUs()
	var diag []DiagLine
	var dmu sync.Mutex
	addDiag := func(l DiagLine) { dmu.Lock(); diag = append(diag, l); dmu.Unlock() }

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
		switch id {
		case "vaapi":
			if len(nodes) == 0 {
				b.Detail = "kein /dev/dri/renderD* gefunden – Grafik nicht durchgereicht? (Docker: Gerät /dev/dri hinzufügen)"
				backs = append(backs, b)
				continue
			}
			b.Device = nodes[0]
			for _, n := range nodes { // pick the first render node that can really encode
				ok1, m1 := d.test("vaapi", n, "h264_vaapi", false, nil)
				addDiag(DiagLine{"vaapi", "h264", false, "Gerät " + n, ok1, m1})
				if ok1 {
					b.Device = n
					break
				}
				ok2, m2 := d.test("vaapi", n, "hevc_vaapi", false, nil)
				addDiag(DiagLine{"vaapi", "hevc", false, "Gerät " + n, ok2, m2})
				if ok2 {
					b.Device = n
					break
				}
			}
		case "qsv":
			// find a start variant that works before testing every codec
			var firstErr string
			for _, v := range qsvVariants(nodes) {
				ok, msg := d.test("qsv", "", "h264_qsv", false, v.init)
				addDiag(DiagLine{"qsv", "h264", false, v.name, ok, msg})
				if ok {
					b.Init, b.Variant = v.init, v.name
					break
				}
				if firstErr == "" {
					firstErr = msg
				}
			}
			if b.Variant == "" {
				b.Detail = qsvHint(firstErr)
				backs = append(backs, b)
				continue
			}
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
			ok, msg := d.test(j.b.ID, j.b.Device, encNames[j.b.ID][j.code], j.ten, j.b.Init)
			if !ok || j.ten || j.b.ID != "vaapi" { // vaapi h264/hevc 8 bit were already logged above
				addDiag(DiagLine{j.b.ID, j.code, j.ten, j.b.Variant, ok, msg})
			}
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

	res := Result{Done: true, GPUs: gpus, Devices: nodes, TookMs: time.Since(start).Milliseconds(), Vainfo: collectVainfo(nodes)}
	res.Backends = append(res.Backends, cpu)
	for _, b := range backs {
		if b.Compiled && len(b.Codecs) == 0 && b.Detail == "" {
			b.Detail = failDetail(b.ID, errs[b.ID])
		}
		if b.Device != "" && len(b.Codecs) > 0 {
			b.GPU = vendorOfNode(b.Device)
		}
		res.Backends = append(res.Backends, *b)
	}
	sort.SliceStable(diag, func(i, j int) bool { return diag[i].Backend < diag[j].Backend })
	res.Diag = diag
	d.mu.Lock()
	d.res = res
	d.mu.Unlock()
}

func (d *Detector) test(backend, device, encoder string, ten bool, init []string) (bool, string) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	pix := "nv12"
	if ten {
		pix = "p010le"
	}
	args := []string{"-hide_banner", "-v", "error", "-nostdin"}
	args = append(args, init...)
	if backend == "vaapi" {
		args = append(args, "-vaapi_device", device)
	}
	args = append(args, "-f", "lavfi", "-i", "color=c=black:s=640x360:r=25:d=0.5")
	vf := "format=" + pix
	if backend == "vaapi" {
		vf += ",hwupload"
	}
	args = append(args, "-vf", vf, "-frames:v", "5", "-c:v", encoder, "-f", "null", "-")
	out, err := proc.CommandContext(ctx, d.tools.FFmpeg, args...).CombinedOutput()
	if err != nil {
		var keep []string
		for _, l := range strings.Split(strings.TrimSpace(string(out)), "\n") {
			if l = strings.TrimSpace(l); l != "" && !strings.Contains(l, "Nothing was written") {
				keep = append(keep, addrRe.ReplaceAllString(l, ""))
			}
		}
		if len(keep) > 4 {
			keep = keep[:4]
		}
		return false, strings.Join(keep, " | ")
	}
	return true, ""
}

// qsvHint turns the raw ffmpeg error into advice.
func qsvHint(raw string) string {
	base := "Quick Sync konnte nicht gestartet werden"
	switch {
	case strings.Contains(raw, "MFX session"), strings.Contains(raw, "libvpl"), strings.Contains(raw, "libmfx"):
		return base + " (keine passende Intel-Runtime/-Grafik gefunden: Gen 8–11 braucht die Media-SDK-Runtime, Gen 12+ oneVPL). VAAPI läuft oft trotzdem – siehe Diagnose"
	case strings.Contains(raw, "Permission denied"):
		return base + ": Zugriff auf /dev/dri verweigert"
	case raw == "":
		return base + " (kein Intel-Gerät erreichbar – Docker: /dev/dri durchreichen)"
	}
	return base + ": " + friendly(raw)
}

var vaProfileRe = regexp.MustCompile(`VAProfile(\w+)\s*:\s*(VAEntrypointEncSlice(?:LP)?|VAEntrypointEncPicture|VAEntrypointFEI)`)

// parseVainfo extracts the driver and the encode-capable profiles from vainfo output.
func parseVainfo(node, text string) Vainfo {
	v := Vainfo{Node: node}
	for _, l := range strings.Split(text, "\n") {
		if i := strings.Index(l, "Driver version:"); i >= 0 {
			v.Driver = strings.TrimSpace(l[i+len("Driver version:"):])
		}
	}
	seen := map[string]bool{}
	for _, m := range vaProfileRe.FindAllStringSubmatch(text, -1) {
		name := m[1]
		if strings.HasSuffix(m[2], "LP") {
			name += " (LP)"
		}
		if !seen[name] {
			seen[name] = true
			v.Encode = append(v.Encode, name)
		}
	}
	return v
}

// collectVainfo summarises `vainfo` per render node (driver and which profiles can encode).
func collectVainfo(nodes []string) []Vainfo {
	p, err := exec.LookPath("vainfo")
	if err != nil {
		return nil
	}
	var out []Vainfo
	for _, n := range nodes {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		b, err := proc.CommandContext(ctx, p, "--display", "drm", "--device", n).CombinedOutput()
		cancel()
		v := parseVainfo(n, string(b))
		if err != nil && v.Driver == "" && v.Error == "" {
			lines := strings.Split(strings.TrimSpace(string(b)), "\n")
			v.Error = strings.TrimSpace(lines[len(lines)-1])
		}
		out = append(out, v)
	}
	return out
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
var (
	nvencNeedRe   = regexp.MustCompile(`Required:\s*([0-9.]+)\s*Found:\s*([0-9.]+)`)
	nvencDriverRe = regexp.MustCompile(`minimum required Nvidia driver for nvenc is ([0-9.]+)`)
)

// failDetail explains in plain words why a backend that is in this ffmpeg could not be used.
func failDetail(id, raw string) string {
	if id == "nvenc" {
		if strings.Contains(raw, "required nvenc API version") {
			need, found, drv := "?", "?", ""
			if m := nvencNeedRe.FindStringSubmatch(raw); m != nil {
				need, found = m[1], m[2]
			}
			if m := nvencDriverRe.FindStringSubmatch(raw); m != nil {
				drv = " (etwa Treiber " + strings.TrimSuffix(m[1], ".00") + " oder neuer)"
			}
			return "Dein NVIDIA-Treiber ist zu alt für NVENC: er kann NVENC " + found + ", dieses ffmpeg braucht " + need + drv + ". Bitte den NVIDIA-Treiber aktualisieren (nvidia.com oder NVIDIA-App)."
		}
		if strings.Contains(raw, "nvcuda") || strings.Contains(raw, "libcuda") || strings.Contains(raw, "No NVENC capable devices") {
			return "Keine NVIDIA-Grafikkarte bzw. kein NVIDIA-Treiber gefunden"
		}
	}
	return "kein Gerät/Treiber nutzbar: " + raw
}

func friendly(m string) string {
	switch {
	case strings.Contains(m, "nvcuda") || strings.Contains(m, "libcuda") || strings.Contains(m, "CUDA_ERROR_NO_DEVICE") || strings.Contains(m, "No NVENC capable devices"):
		return "keine NVIDIA-GPU/-Treiber erreichbar (Docker: --runtime=nvidia bzw. NVIDIA-Treiber installieren)"
	case strings.Contains(m, "MFX session") || strings.Contains(m, "libvpl") || strings.Contains(m, "libmfx"):
		return "Quick-Sync-Sitzung konnte nicht erstellt werden (Intel-Runtime/Grafik passt nicht oder /dev/dri fehlt)"
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
