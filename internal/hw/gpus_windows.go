package hw

import (
	"os/exec"
	"strings"
)

func listGPUs() []string {
	b, err := exec.Command("powershell", "-NoProfile", "-Command",
		"(Get-CimInstance Win32_VideoController).Name").Output()
	if err != nil {
		return nil
	}
	var out []string
	for _, l := range strings.Split(string(b), "\n") {
		if l = strings.TrimSpace(l); l != "" {
			out = append(out, l)
		}
	}
	return out
}
