// Package proc starts helper programs (ffmpeg, ffprobe, nvidia-smi, powershell …). Under Windows a program without its own
// console would flash a black console window for every helper process; there the window is suppressed.
package proc

import (
	"context"
	"os/exec"
)

// Command is exec.Command without a visible console window (Windows).
func Command(name string, args ...string) *exec.Cmd {
	c := exec.Command(name, args...)
	hide(c)
	return c
}

// CommandContext is exec.CommandContext without a visible console window (Windows).
func CommandContext(ctx context.Context, name string, args ...string) *exec.Cmd {
	c := exec.CommandContext(ctx, name, args...)
	hide(c)
	return c
}
