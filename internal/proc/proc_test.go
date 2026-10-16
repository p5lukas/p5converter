package proc

import (
	"context"
	"testing"
)

func TestCommandRuns(t *testing.T) {
	if _, err := Command("go", "version").Output(); err != nil {
		t.Skip("go nicht im PATH")
	}
	if err := CommandContext(context.Background(), "go", "version").Run(); err != nil {
		t.Error(err)
	}
}
