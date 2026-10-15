//go:build !linux && !windows

package hw

type samplerState struct{}

func (s *Sampler) sample() Stats { return Stats{CPU: -1} }
