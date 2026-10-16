//go:build !windows

package main

// Nur unter Windows gibt es ein eigenes App-Fenster (desktop_windows.go); sonst öffnet main den Browser bzw. ein App-Fenster per Chrome/Edge.
func setupDesktop()                                                        {}
func bringToFront(base string) bool                                        { return false }
func desktopWindow(url string, busy func() int, setShow func(func())) bool { return false }
func showError(title, msg string)                                          {}
