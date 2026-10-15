package rename

import (
	"testing"

	"github.com/p5lukas/p5converter/internal/ffmpeg"
)

func info() *ffmpeg.Info {
	return &ffmpeg.Info{Tags: map[string]string{"title": "Der Flug", "date": "2023-05-01", "artist": "A/B", "track": "3/12"},
		Streams: []ffmpeg.Stream{{Index: 0, Type: "video", Codec: "hevc", Height: 1080, Width: 1920, BitDepth: 8}}}
}

func TestApplyRules(t *testing.T) {
	cases := []struct {
		name  string
		rules []Rule
		want  string
	}{
		{"literal ci", []Rule{{Find: "webdl", With: "WEB"}}, "Show [WEB-1080p] Boogey"},
		{"literal case", []Rule{{Find: "webdl", With: "WEB", Case: true}}, "Show [WEBDL-1080p] Boogey"},
		{"chain", []Rule{{Find: "[WEBDL-1080p] ", With: ""}, {Find: "Boogey", With: "x"}}, "Show x"},
		{"regex groups", []Rule{{Find: `\[(\w+)-(\d+p)\]`, With: "$2 $1", Regex: true}}, "Show 1080p WEBDL Boogey"},
		{"empty ignored", []Rule{{Find: "", With: "x"}}, "Show [WEBDL-1080p] Boogey"},
	}
	for _, c := range cases {
		got, err := Apply("Show [WEBDL-1080p] Boogey", c.rules)
		if err != nil || got != c.want {
			t.Errorf("%s: %q %v (want %q)", c.name, got, err, c.want)
		}
	}
	if Validate([]Rule{{Find: "(", Regex: true}}) == nil {
		t.Error("ungültige Regex muss abgelehnt werden")
	}
	if Validate(make([]Rule, MaxRules+1)) == nil {
		t.Error("zu viele Regeln müssen abgelehnt werden")
	}
}

func TestNewName(t *testing.T) {
	n, err := NewName("{title} ({year}) [{res}][{codec}][{bit}]", nil, "", info(), "/m/Film.mkv", Target{Codec: "hevc", Height: 720, BitDepth: 10, Container: "mkv"})
	if err != nil || n != "Der Flug (2023) [720p][x265][10bit]" {
		t.Errorf("%q %v", n, err)
	}
	// source values when nothing is converted
	n, _ = NewName("{filename} {res} {codec}", nil, "", info(), "/m/Film.mkv", Target{})
	if n != "Film 1080p x265" {
		t.Errorf("%q", n)
	}
	// rules run on the file part only, folders from the pattern stay
	n, _ = NewName("{artist}/{track} - {title}", []Rule{{Find: "Flug", With: "Weg"}}, "_x", info(), "/m/a.mp3", Target{})
	if n != "A_B/03 - Der Weg_x" {
		t.Errorf("%q", n)
	}
	// no pattern: the old name, then rules, then suffix
	n, _ = NewName("", []Rule{{Find: "Film", With: "Movie"}}, "_neu", info(), "/m/Film.mkv", Target{})
	if n != "Movie_neu" {
		t.Errorf("%q", n)
	}
	if _, err := NewName("", []Rule{{Find: "Film", With: ""}}, "", info(), "/m/Film.mkv", Target{}); err == nil {
		t.Error("leerer Name muss abgelehnt werden")
	}
}
