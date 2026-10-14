package hw

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func listGPUs() []string {
	var out []string
	if p, err := exec.LookPath("nvidia-smi"); err == nil {
		if b, err := exec.Command(p, "--query-gpu=name", "--format=csv,noheader").Output(); err == nil {
			for _, l := range strings.Split(strings.TrimSpace(string(b)), "\n") {
				if l = strings.TrimSpace(l); l != "" {
					out = append(out, "NVIDIA "+strings.TrimPrefix(l, "NVIDIA "))
				}
			}
		}
	}
	seen := map[string]bool{}
	for _, n := range renderNodes() {
		v := vendorOfNode(n)
		if v == "NVIDIA" {
			continue
		}
		slot := ""
		if b, err := os.ReadFile("/sys/class/drm/" + filepath.Base(n) + "/device/uevent"); err == nil {
			for _, l := range strings.Split(string(b), "\n") {
				if s, ok := strings.CutPrefix(l, "PCI_SLOT_NAME="); ok {
					slot = s
				}
			}
		}
		name := v + " GPU"
		if lp, err := exec.LookPath("lspci"); err == nil && slot != "" {
			if b, err := exec.Command(lp, "-mm", "-s", slot).Output(); err == nil {
				f := strings.Split(string(b), "\"")
				if len(f) >= 6 {
					name = f[3] + " " + f[5]
				}
			}
		}
		name += " (" + filepath.Base(n) + ")"
		if !seen[name] {
			seen[name] = true
			out = append(out, name)
		}
	}
	return out
}
