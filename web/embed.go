// Package web embeds the single-page UI.
package web

import "embed"

//go:embed index.html app.js style.css
var FS embed.FS
