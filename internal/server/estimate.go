package server

// Schätzung der Ersparnis beim Umwandeln mit H.265 auf der Stufe „Gut“: ein grober Anteil der heutigen Größe aus Codec und Bitrate. Die Stützpunkte stammen aus
// Messungen an echten Folgen (H.264, 1080p: bei etwa 5 Mbit/s landet „Gut“ bei gut der Hälfte, bei etwa 3 Mbit/s bei vier Fünfteln); sie sind eine Schätzung,
// kein Versprechen. Der Ton ist nicht eingerechnet. In der Oberfläche steht deshalb immer „≈“ und „Schätzung“.

var estimateCurve = [][2]float64{{1.5, 0.95}, {2.9, 0.82}, {4.9, 0.57}, {8, 0.40}} // Mbit/s (auf 1080p umgerechnet) → Anteil der heutigen Größe

// estimateRatio: Anteil der heutigen Größe, den die Datei nach dem Umwandeln noch haben dürfte (1 = keine Ersparnis)
func estimateRatio(codec string, size int64, dur float64, height int) float64 {
	switch codec {
	case "hevc", "av1", "vp9":
		return 0.97 // schon modern: kaum etwas zu holen
	case "?", "":
		return 1
	}
	if size <= 0 || dur <= 0 {
		return 1
	}
	m := float64(size) * 8 / dur / 1e6
	if height > 0 {
		k := 1080 / float64(height)
		m *= k * k // gleiche Bildpunkte wie 1080p
	}
	c := estimateCurve
	switch {
	case m <= c[0][0]:
		return c[0][1]
	case m >= c[len(c)-1][0]:
		return c[len(c)-1][1]
	}
	for i := 1; i < len(c); i++ {
		if m <= c[i][0] {
			t := (m - c[i-1][0]) / (c[i][0] - c[i-1][0])
			return c[i-1][1] + t*(c[i][1]-c[i-1][1])
		}
	}
	return 1
}
