// Package web embeds the single-page UI.
package web

import "embed"

//go:embed index.html app.js info.js planets.js style.css icon.png icon-192.png icon-512.png apple-touch-icon.png
var FS embed.FS
