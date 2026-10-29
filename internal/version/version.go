// Package version holds the program version and build information.
// Tag, Branch and Commit are set at build time (see docker/Dockerfile and the workflow).
package version

import "strings"

// Base is the current development version. Raised by one patch step per "leg los" (see CLAUDE.md).
const Base = "0.4.1"

var (
	Tag    string // e.g. "v0.1.0" for tag builds
	Branch string // e.g. "main"
	Commit string // full commit sha
	Repo   = "https://github.com/p5lukas/p5converter"
)

type Info struct {
	Version     string `json:"version"`
	Base        string `json:"base"`
	Tag         string `json:"tag"`
	Branch      string `json:"branch"`
	Commit      string `json:"commit"`
	CommitShort string `json:"commitShort"`
	Repo        string `json:"repo"`
	BranchURL   string `json:"branchUrl"`
	CommitURL   string `json:"commitUrl"`
}

func Get() Info {
	tag := strings.TrimPrefix(Tag, "v")
	short := Commit
	if len(short) > 7 {
		short = short[:7]
	}
	local := Tag == "" && Branch == "" && Commit == ""
	v := tag
	branch := Branch
	switch {
	case tag != "":
	case local:
		v = Base + "-dev (lokal)"
		branch = "dev (lokal)"
	default:
		b := Branch
		if b == "" {
			b = "dev"
		}
		v = Base + "-" + b
		if short != "" {
			v += "+" + short
		}
	}
	i := Info{Version: v, Base: Base, Tag: tag, Branch: branch, Commit: Commit, CommitShort: short, Repo: Repo}
	switch {
	case tag != "":
		i.BranchURL = Repo + "/releases/tag/v" + tag
	case Branch != "":
		i.BranchURL = Repo + "/tree/" + Branch
	default:
		i.BranchURL = Repo
	}
	if Commit != "" {
		i.CommitURL = Repo + "/commit/" + Commit
	}
	return i
}
