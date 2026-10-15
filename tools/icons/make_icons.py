#!/usr/bin/env python3
"""Erzeugt alle App-Icons (SVG-Quelle + PNG-Größen) für p5assets und p5converter nach demselben Muster.

Aufbau wie p5assets: abgerundetes Quadrat, dunkler Matrix-Regen, grüner leuchtender Poster-Rahmen im Hochformat
mit „p5_“. Unterschied: unten rechts ein Abzeichen – p5converter: silberne Audio-CD + blaue Blu-ray (Audio und Video), p5assets: oranger Flammen-Komet (Kometa).
Das „p5“ ist etwas kleiner als beim alten Icon, damit das Abzeichen Platz hat.

Aufruf:  python3 make_icons.py <converter|assets> <ausgabeverzeichnis> [--png-dir DIR ...]
  Erzeugt icon.svg (Rund) und icon-full.svg (randlos) und rendert mit Chromium (Playwright) die PNG-Größen:
  icon.png 256 RGBA (rund, mit Transparenz), icon-192.png, icon-512.png, apple-touch-icon.png 180 (randlos, opak).
Umgebung: PLAYWRIGHT_PATH (Pfad zu playwright), CHROMIUM_PATH.
"""
import os, random, subprocess, sys, json, tempfile

GREEN = "#00ff66"
BG = "#02100a"      # randlose Fläche (wie p5assets)
PLATE = "#020a05"   # Platte mit Regen

def rain(seed, w=512, h=512):
    rnd = random.Random(seed)
    glyphs = "XZ<>+=|:*10MPAN5!-"
    out = []
    x = 14
    while x < w:
        n = rnd.randint(8, 18)
        y0 = rnd.randint(-160, 260)
        step = 29
        for i in range(n):
            y = y0 + i * step
            if y < -20 or y > h + 20:
                continue
            ch = rnd.choice(glyphs)
            head = i == n - 1
            op = 0.16 + 0.62 * (i / n) ** 1.4
            if head:
                op = 0.9
            col = "#b6ffd0" if head else GREEN
            rot = rnd.choice([0, 0, 0, 0, 90, 270])
            out.append(f'<text x="{x}" y="{y}" fill="{col}" fill-opacity="{op:.2f}" transform="rotate({rot} {x} {y-8})">{ch}</text>')
        x += rnd.randint(26, 36)
    return "\n".join(out)

def disc(x, y, r, typ):
    """Scheibe mit Glanzbögen und Mittelloch: typ 'bd' = blaue Blu-ray, 'cd' = silberne Audio-CD."""
    fill = "url(#disc)" if typ == "bd" else "url(#cdsil)"
    edge = "#9fd0ff" if typ == "bd" else "#f2f6fb"
    rings = ("#bfe0ff" if typ == "bd" else "#ffffff")
    extra = ""
    if typ == "cd":  # leichter Regenbogen-Schimmer wie bei einer CD
        extra = (f'<path d="M{x-r*.72:.1f} {y+r*.2:.1f} A{r*.74:.1f} {r*.74:.1f} 0 0 1 {x-r*.1:.1f} {y-r*.73:.1f}" fill="none" stroke="#ff9ad8" stroke-opacity=".55" stroke-width="5" stroke-linecap="round"/>'
                 f'<path d="M{x+r*.72:.1f} {y-r*.15:.1f} A{r*.74:.1f} {r*.74:.1f} 0 0 1 {x+r*.2:.1f} {y+r*.7:.1f}" fill="none" stroke="#7fe0ff" stroke-opacity=".55" stroke-width="5" stroke-linecap="round"/>')
    return (f'<circle cx="{x}" cy="{y}" r="{r}" fill="{fill}" stroke="{edge}" stroke-width="3"/>'
            f'<circle cx="{x}" cy="{y}" r="{r-11}" fill="none" stroke="{rings}" stroke-opacity=".32" stroke-width="2"/>'
            f'<circle cx="{x}" cy="{y}" r="{r-22}" fill="none" stroke="{rings}" stroke-opacity=".22" stroke-width="2"/>'
            f'<path d="M{x-r+8} {y-5} A{r-8} {r-8} 0 0 1 {x-6} {y-r+8}" fill="none" stroke="#ffffff" stroke-opacity=".85" stroke-width="5" stroke-linecap="round"/>'
            f'{extra}<circle cx="{x}" cy="{y}" r="{max(r*.26,10):.1f}" fill="#e8f1fb"/><circle cx="{x}" cy="{y}" r="{max(r*.14,6):.1f}" fill="#03160c"/>')

def badge(kind):
    """Abzeichen unten rechts (Mitte 380,380, Radius 96)."""
    cx, cy, r = 380, 380, 96
    base = (f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="#03160c" stroke="{GREEN}" stroke-width="10" filter="url(#glow)"/>')
    if kind == "converter":
        # zwei gleich große Scheiben, symmetrisch um die Mitte des Abzeichens: silberne Audio-CD hinten, blaue Blu-ray vorn
        return base + f'<g filter="url(#glowb)">{disc(cx-20, cy-16, 50, "cd")}{disc(cx+20, cy+16, 50, "bd")}</g>'
    # Komet/Feuerball (eigene Zeichnung im Stil eines Flammen-Kometen, ohne Buchstaben): Kopf unten links, Schweif nach rechts oben
    hx, hy = cx - 22, cy + 24
    def tongue(angle, length, width, op=1.0):
        # Flammenzunge, zeigt nach +x (Spitze bei length), um den Kopf gedreht
        l, w = length, width
        d = f"M0 {-w} C{l*.35} {-w*1.5} {l*.7} {-w*.6} {l} 0 C{l*.7} {w*.6} {l*.35} {w*1.5} 0 {w} Z"
        return (f'<path d="{d}" transform="translate({hx} {hy}) rotate({angle})" fill="url(#flame)" fill-opacity="{op}"/>')
    tongues = (tongue(-52, 112, 15) + tongue(-34, 92, 12, .95) + tongue(-70, 84, 11, .9) + tongue(-18, 66, 9, .85) + tongue(-86, 62, 8, .8))
    head = (f'<circle cx="{hx}" cy="{hy}" r="27" fill="url(#ball)"/>'
            f'<circle cx="{hx-5}" cy="{hy-5}" r="11" fill="#fff4c2" fill-opacity=".9"/>')
    spark = ''.join(f'<circle cx="{x}" cy="{y}" r="{s}" fill="#ffc83a"/>' for x, y, s in [(cx+58, cy-18, 3.5), (cx+20, cy-66, 3), (cx+66, cy+14, 2.5)])
    return base + f'<g filter="url(#glowo)">{tongues}{head}</g>' + spark

def svg(kind, rounded):
    plate = (f'<rect width="512" height="512" rx="112" fill="{PLATE}"/>' if rounded else
             f'<rect width="512" height="512" fill="{BG}"/><rect x="44" y="44" width="424" height="424" rx="96" fill="{PLATE}"/>')
    clip = ('<clipPath id="pl"><rect width="512" height="512" rx="112"/></clipPath>' if rounded else
            '<clipPath id="pl"><rect x="44" y="44" width="424" height="424" rx="96"/></clipPath>')
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<defs>
{clip}
<filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="glow2" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<linearGradient id="flame" gradientUnits="objectBoundingBox" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff7a00"/><stop offset=".45" stop-color="#ffa800"/><stop offset="1" stop-color="#ffd23a" stop-opacity="0"/></linearGradient>
<radialGradient id="ball" cx=".4" cy=".4" r=".7"><stop offset="0" stop-color="#fff4c2"/><stop offset=".5" stop-color="#ffb400"/><stop offset="1" stop-color="#ff6a00"/></radialGradient>
<radialGradient id="cdsil" cx=".35" cy=".3" r=".9"><stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#cfd7e0"/><stop offset="1" stop-color="#8d98a6"/></radialGradient>
<radialGradient id="disc" cx=".35" cy=".3" r=".9"><stop offset="0" stop-color="#8ec5ff"/><stop offset=".45" stop-color="#2d8cff"/><stop offset="1" stop-color="#1239b8"/></radialGradient>
<filter id="glowb" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="glowo" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>
{plate}
<g clip-path="url(#pl)" font-family="DejaVu Sans Mono, Menlo, Consolas, monospace" font-weight="700" font-size="26">
{rain(7 if kind == "assets" else 11)}
</g>
<rect x="132" y="84" width="236" height="318" rx="22" fill="#020f08" fill-opacity=".72" stroke="{GREEN}" stroke-width="10" filter="url(#glow)"/>
<g fill="{GREEN}" font-family="DejaVu Sans, Verdana, Arial, sans-serif" font-weight="700" filter="url(#glow2)">
<text x="250" y="282" font-size="138" text-anchor="middle">p5</text>
<rect x="198" y="306" width="104" height="10" rx="2"/>
</g>
{badge(kind)}
</svg>
'''

def render(svg_files, out_dir):
    js = os.path.join(tempfile.gettempdir(), "p5icons_render.js")
    open(js, "w").write("""
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('fs');
(async () => {
  const jobs = JSON.parse(process.argv[2]);
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  for (const j of jobs) {
    const p = await b.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
    const svg = fs.readFileSync(j.svg, 'utf8').replace('width="512" height="512"', 'width="1024" height="1024"');
    await p.setContent('<html><body style="margin:0;background:transparent">' + svg + '</body></html>');
    await p.waitForTimeout(300);
    await p.screenshot({ path: j.png, omitBackground: true, clip: { x: 0, y: 0, width: 1024, height: 1024 } });
    await p.close();
  }
  await b.close();
})();
""")
    jobs = [{"svg": s, "png": p} for s, p in svg_files]
    subprocess.run(["node", js, json.dumps(jobs)], check=True)

def main():
    kind, out = sys.argv[1], sys.argv[2]
    assert kind in ("converter", "assets")
    os.makedirs(out, exist_ok=True)
    rounded, full = os.path.join(out, "icon.svg"), os.path.join(out, "icon-full.svg")
    open(rounded, "w").write(svg(kind, True))
    open(full, "w").write(svg(kind, False))
    tmp = tempfile.mkdtemp()
    render([(rounded, os.path.join(tmp, "round.png")), (full, os.path.join(tmp, "full.png"))], out)
    from PIL import Image
    r = Image.open(os.path.join(tmp, "round.png")).convert("RGBA")
    f = Image.open(os.path.join(tmp, "full.png")).convert("RGB")
    def save(im, name, size):
        im.resize((size, size), Image.LANCZOS).save(os.path.join(out, name), optimize=True)
    save(r, "icon.png", 256)
    save(f, "icon-192.png", 192)
    save(f, "icon-512.png", 512)
    save(f, "apple-touch-icon.png", 180)
    print("fertig:", out)

if __name__ == "__main__":
    main()
