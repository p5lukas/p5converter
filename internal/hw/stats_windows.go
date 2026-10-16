package hw

import (
	"encoding/csv"
	"github.com/p5lukas/p5converter/internal/proc"
	"strconv"
	"strings"
)

type samplerState struct{}

// sample uses typeperf (ships with Windows): GPU engine counters per engine type.
func (s *Sampler) sample() Stats {
	out := Stats{CPU: -1}
	b, err := proc.Command("typeperf", `\GPU Engine(*)\Utilization Percentage`, `\Processor(_Total)\% Processor Time`, "-sc", "1").Output()
	if err != nil {
		return out
	}
	r := csv.NewReader(strings.NewReader(strings.ReplaceAll(string(b), "\r", "")))
	r.FieldsPerRecord = -1
	rows, _ := r.ReadAll()
	if len(rows) < 2 {
		return out
	}
	hdr, val := rows[0], rows[1]
	g := GPUStat{Name: "GPU (Windows)", Kind: "gpu", Util: 0, Encode: 0, Decode: 0, Source: "typeperf GPU Engine"}
	found := false
	for i := 1; i < len(hdr) && i < len(val); i++ {
		v, err := strconv.ParseFloat(strings.TrimSpace(val[i]), 64)
		if err != nil {
			continue
		}
		h := hdr[i]
		switch {
		case strings.Contains(h, "Processor"):
			out.CPU = v
		case strings.Contains(h, "engtype_VideoEncode"):
			g.Encode += v
			found = true
		case strings.Contains(h, "engtype_VideoDecode"):
			g.Decode += v
			found = true
		case strings.Contains(h, "engtype_3D"), strings.Contains(h, "engtype_Compute"), strings.Contains(h, "engtype_VideoProcessing"):
			g.Util += v
			found = true
		}
	}
	if found {
		out.GPUs = append(out.GPUs, g)
	}
	return out
}
