//go:build windows

package main

import (
	_ "embed"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"unsafe"

	"fyne.io/systray"
	webview2 "github.com/jchv/go-webview2"
	"github.com/p5lukas/p5converter/internal/proc"
	"golang.org/x/sys/windows"
)

// Windows-App (Variante B): die Weboberfläche in einem eigenen Fenster (Microsoft Edge WebView2) statt im Browser.
// Alles in einer .exe: das WebView2-Ladeprogramm steckt in der Bibliothek; nur die WebView2-Laufzeit selbst muss auf dem PC
// sein (Windows 11 und aktuelles Windows 10 haben sie; sonst installiert sie der Installer).

const windowTitle = "p5converter"

//go:embed windows/p5converter.ico
var trayIcon []byte

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
	title, _ := windows.UTF16PtrFromString(windowTitle)
	class, _ := windows.UTF16PtrFromString("webview") // Fensterklasse der WebView2-Bibliothek
	find := user32.NewProc("FindWindowW")
	hwnd, _, _ := find.Call(0, uintptr(unsafe.Pointer(title)))
	if hwnd == 0 {
		hwnd, _, _ = find.Call(uintptr(unsafe.Pointer(class)), 0)
	}
	if hwnd == 0 {
		return false
	}
	showWindow(hwnd) // zeigt auch ein im Infobereich verstecktes Fenster
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
func desktopWindow(url string, busy func() int) (shown bool) {
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
	hwnd := uintptr(w.Window())
	startTray(hwnd, busy)
	hideOnClose(hwnd)
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

var (
	user32            = windows.NewLazySystemDLL("user32.dll")
	pShowWindow       = user32.NewProc("ShowWindow")
	pSetForeground    = user32.NewProc("SetForegroundWindow")
	pSetWindowLongPtr = user32.NewProc("SetWindowLongPtrW")
	pCallWindowProc   = user32.NewProc("CallWindowProcW")
	origWndProc       uintptr
)

const (
	idYes     = 6
	wmClose   = 0x0010
	swHide    = 0
	swRestore = 9
	swShow    = 5
)

func showWindow(hwnd uintptr) {
	pShowWindow.Call(hwnd, swRestore)
	pSetForeground.Call(hwnd)
}

// hideOnClose: das Schließen-Kreuz versteckt das Fenster (das Programm läuft im Infobereich weiter, laufende Aufträge
// bleiben erhalten); beendet wird über das Symbol im Infobereich oder den Knopf „Beenden“ in der Oberfläche.
func hideOnClose(hwnd uintptr) {
	gwlpWndProc := ^uintptr(3) // -4
	cb := windows.NewCallback(func(h, msg, wp, lp uintptr) uintptr {
		if msg == wmClose {
			pShowWindow.Call(h, swHide)
			return 0
		}
		r, _, _ := pCallWindowProc.Call(origWndProc, h, msg, wp, lp)
		return r
	})
	origWndProc, _, _ = pSetWindowLongPtr.Call(hwnd, gwlpWndProc, cb)
}

// startTray legt das Symbol im Infobereich an: Klick oder „Öffnen“ zeigt das Fenster, „Beenden“ beendet das Programm
// (mit Rückfrage, wenn noch Aufträge laufen). Eigener Thread mit eigener Nachrichtenschleife.
func startTray(hwnd uintptr, busy func() int) {
	go func() {
		runtime.LockOSThread()
		systray.Run(func() {
			systray.SetIcon(trayIcon)
			systray.SetTitle(windowTitle)
			systray.SetTooltip("p5converter – läuft im Hintergrund weiter")
			open := systray.AddMenuItem("p5converter öffnen", "Fenster anzeigen")
			systray.AddSeparator()
			quit := systray.AddMenuItem("Beenden", "p5converter beenden")
			systray.SetOnTapped(func() { showWindow(hwnd) })
			go func() {
				for {
					select {
					case <-open.ClickedCh:
						showWindow(hwnd)
					case <-quit.ClickedCh:
						if n := busy(); n > 0 {
							msg := "Es laufen oder warten noch " + itoa(n) + " Aufträge. Trotzdem beenden und abbrechen?"
							t, _ := windows.UTF16PtrFromString("p5converter beenden")
							m, _ := windows.UTF16PtrFromString(msg)
							if r, _ := windows.MessageBox(0, m, t, windows.MB_YESNO|windows.MB_ICONQUESTION); r != idYes {
								continue
							}
						}
						os.Exit(0) // das Job-Objekt beendet auch laufende ffmpeg-Prozesse
					}
				}
			}()
		}, nil)
	}()
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for ; n > 0; n /= 10 {
		b = append([]byte{byte('0' + n%10)}, b...)
	}
	return string(b)
}
