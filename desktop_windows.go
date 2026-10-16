//go:build windows

package main

import (
	"github.com/p5lukas/p5converter/internal/proc"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"
)

// Windows-App (Variante B): die Weboberfläche in einem eigenen Fenster (Microsoft Edge WebView2) statt im Browser.
// Alles in einer .exe: das WebView2-Ladeprogramm steckt in der Bibliothek; nur die WebView2-Laufzeit selbst muss auf dem PC
// sein (Windows 11 und aktuelles Windows 10 haben sie; sonst installiert sie der Installer).

const windowTitle = "p5converter"

func init() { runtime.LockOSThread() } // das Fenster muss auf dem Haupt-Thread laufen

// setupDesktop: ein Programm-Mutex (der Installer erkennt damit ein laufendes Programm und bittet zum Schließen) und ein
// „Job“, der alle ffmpeg-Prozesse beendet, wenn p5converter endet (sonst liefe ffmpeg nach dem Schließen weiter).
func setupDesktop() {
	if name, err := windows.UTF16PtrFromString("p5converter-single-instance"); err == nil {
		windows.CreateMutex(nil, false, name) // Handle bleibt bis zum Prozessende offen
	}
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return
	}
	var info windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION
	info.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err := windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info))); err != nil {
		return
	}
	windows.AssignProcessToJobObject(job, windows.CurrentProcess())
}

// bringToFront holt das Fenster eines schon laufenden p5converter nach vorn (zweiter Start). false = kein Fenster gefunden.
func bringToFront() bool {
	user32 := windows.NewLazySystemDLL("user32.dll")
	title, _ := windows.UTF16PtrFromString(windowTitle)
	hwnd, _, _ := user32.NewProc("FindWindowW").Call(0, uintptr(unsafe.Pointer(title)))
	if hwnd == 0 {
		return false
	}
	user32.NewProc("ShowWindow").Call(hwnd, 9) // SW_RESTORE
	user32.NewProc("SetForegroundWindow").Call(hwnd)
	return true
}

// externalLinks: Links auf andere Adressen (GitHub …) öffnen im Standardbrowser, nicht im App-Fenster.
const externalLinks = `(function(){
  var ext=function(u){try{var x=new URL(u,location.href);return (x.protocol==='http:'||x.protocol==='https:')&&x.origin!==location.origin}catch(e){return false}};
  document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[href]');if(a&&ext(a.href)){e.preventDefault();window.p5OpenExternal(a.href)}},true);
  var wo=window.open;window.open=function(u){if(u&&ext(String(u))){window.p5OpenExternal(String(u));return null}return wo.apply(window,arguments)};
})();`

// desktopWindow zeigt die Oberfläche im App-Fenster und kehrt erst zurück, wenn das Fenster geschlossen wurde (true).
// false = WebView2 fehlt oder ließ sich nicht starten; dann öffnet der Aufrufer ersatzweise einen Browser.
func desktopWindow(url string) (shown bool) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("App-Fenster fehlgeschlagen: %v", r)
			shown = false
		}
	}()
	data := ""
	if d, err := os.UserCacheDir(); err == nil {
		data = filepath.Join(d, "p5converter", "webview2")
	}
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		AutoFocus: true,
		DataPath:  data,
		WindowOptions: webview2.WindowOptions{
			Title: windowTitle, Width: 1360, Height: 900, IconId: 1, Center: true,
		},
	})
	if w == nil {
		log.Print("WebView2 nicht verfügbar – ersatzweise Browser.")
		return false
	}
	defer w.Destroy()
	w.SetSize(960, 640, webview2.HintMin)
	w.Bind("p5OpenExternal", func(u string) { proc.Command("rundll32", "url.dll,FileProtocolHandler", u).Start() })
	w.Init(externalLinks)
	w.Navigate(url)
	w.Run()
	return true
}

// showError zeigt eine Fehlermeldung als normales Windows-Fenster (das Programm hat keine Konsole).
func showError(title, msg string) {
	t, _ := windows.UTF16PtrFromString(title)
	m, _ := windows.UTF16PtrFromString(msg)
	windows.MessageBox(0, m, t, windows.MB_OK|windows.MB_ICONERROR)
}
