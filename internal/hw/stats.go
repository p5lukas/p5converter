package hw

import "sync"

// GPUStat is one live utilisation reading. Negative values mean "unknown".
type GPUStat struct {
	Name   string  `json:"name"`
	Kind   string  `json:"kind"`   // nvidia intel amd gpu
	Util   float64 `json:"util"`   // overall busy %
	Encode float64 `json:"encode"` // video encode engine %
	Decode float64 `json:"decode"` // video decode engine %
	Source string  `json:"source"`
}

type Stats struct {
	CPU  float64   `json:"cpu"` // -1 unknown
	GPUs []GPUStat `json:"gpus"`
}

// Sampler keeps the latest reading; Sample is called periodically while jobs run.
type Sampler struct {
	mu   sync.Mutex
	last Stats
	st   samplerState
}

func NewSampler() *Sampler { return &Sampler{last: Stats{CPU: -1}} }

func (s *Sampler) Latest() Stats {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.last
}

func (s *Sampler) Sample() {
	st := s.sample()
	s.mu.Lock()
	s.last = st
	s.mu.Unlock()
}
