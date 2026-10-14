//go:build !linux && !windows

package hw

func listGPUs() []string { return nil }
