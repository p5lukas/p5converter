package version

import "testing"

func TestGet(t *testing.T) {
	defer func(a, b, c string) { Tag, Branch, Commit = a, b, c }(Tag, Branch, Commit)
	Tag, Branch, Commit = "", "", ""
	if v := Get().Version; v != Base+"-dev (lokal)" {
		t.Errorf("lokal: %s", v)
	}
	Tag, Branch, Commit = "", "main", "0123456789abcdef"
	if i := Get(); i.Version != Base+"-main+0123456" || i.CommitShort != "0123456" {
		t.Errorf("branch: %+v", i)
	}
	Tag, Branch, Commit = "v0.1.0", "", "0123456789abcdef"
	if i := Get(); i.Version != "0.1.0" || i.BranchURL != Repo+"/releases/tag/v0.1.0" {
		t.Errorf("tag: %+v", i)
	}
}
