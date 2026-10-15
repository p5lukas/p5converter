package hw

import (
	"math"
	"testing"
	"time"
)

func TestCPUPercent(t *testing.T) {
	if v := cpuPercent(0, 0, 1000, 800); v != -1 {
		t.Errorf("erste Messung: %v", v)
	}
	if v := cpuPercent(1000, 800, 2000, 1600); math.Abs(v-20) > 1e-9 { // 200 of 1000 ticks busy
		t.Errorf("20 %% erwartet: %v", v)
	}
	if v := cpuPercent(1000, 800, 2000, 1800); v != 0 { // idle only
		t.Errorf("Leerlauf: %v", v)
	}
	if v := cpuPercent(2000, 1600, 1000, 800); v != -1 { // counter reset
		t.Errorf("Rücksprung: %v", v)
	}
}

func TestRC6Busy(t *testing.T) {
	// 1 s interval, slept 1000 ms -> idle
	if v, ok := rc6Busy(5000, 6000, time.Second); !ok || v != 0 {
		t.Errorf("Ruhezustand: %v %v", v, ok)
	}
	// slept 250 ms of 1000 -> 75 % awake
	if v, ok := rc6Busy(5000, 5250, time.Second); !ok || v != 75 {
		t.Errorf("75 %%: %v %v", v, ok)
	}
	// never slept -> 100 % awake
	if v, ok := rc6Busy(5000, 5000, time.Second); !ok || v != 100 {
		t.Errorf("100 %%: %v %v", v, ok)
	}
	// counter jitter above the interval must not go below 0 / above 100
	if v, ok := rc6Busy(0, 1100, time.Second); !ok || v != 0 {
		t.Errorf("Überlauf: %v %v", v, ok)
	}
	if _, ok := rc6Busy(6000, 5000, time.Second); ok {
		t.Error("Rücksprung muss verworfen werden")
	}
	if _, ok := rc6Busy(0, 10, 50*time.Millisecond); ok {
		t.Error("zu kurzes Intervall muss verworfen werden")
	}
}
