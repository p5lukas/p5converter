// Package web embeds the single-page UI.
package web

import "embed"

//go:embed index.html app.js info.js settings.js auth.js icons.js rename.js flow.js trkplan.js tracks.js verify.js quality.js crf.js convert.js library.js rain.js logs.js history.js style.css favicon.ico favicon-32.png favicon-48.png icon.png icon-192.png icon-512.png apple-touch-icon.png
var FS embed.FS
