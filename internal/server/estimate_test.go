package server

import "testing"

// Die Schätzung wird mit der Bitrate größer (mehr zu holen), ändert sich nie sprunghaft und liegt immer zwischen 0 und 1.
func TestEstimateRatio(t *testing.T) {
	const dur = 3600.0
	at := func(mbit float64, h int) float64 { return estimateRatio("h264", int64(mbit*1e6/8*dur), dur, h) }
	if r := estimateRatio("hevc", 1e9, dur, 1080); r < 0.9 || r > 1 {
		t.Errorf("schon H.265: %.2f", r)
	}
	if r := estimateRatio("?", 1e9, dur, 1080); r != 1 {
		t.Errorf("kein Video: %.2f", r)
	}
	if r := estimateRatio("h264", 0, 0, 1080); r != 1 {
		t.Errorf("ohne Angaben: %.2f", r)
	}
	prev := 2.0
	for _, m := range []float64{0.5, 1.5, 2, 2.9, 4, 4.9, 6, 8, 12, 30} {
		r := at(m, 1080)
		if r <= 0 || r > 1 || r > prev+1e-9 {
			t.Errorf("%.1f Mbit/s: %.3f (davor %.3f)", m, r, prev)
		}
		prev = r
	}
	if r := at(4.9, 1080); r < 0.5 || r > 0.62 {
		t.Errorf("4,9 Mbit/s @1080p sollte bei gut der Hälfte liegen: %.2f", r)
	}
	// 720p mit 2,2 Mbit/s entspricht etwa 5 Mbit/s bei 1080p
	if a, b := at(2.2, 720), at(4.95, 1080); a < b-0.03 || a > b+0.03 {
		t.Errorf("Bildpunkte: %.3f gegen %.3f", a, b)
	}
}
