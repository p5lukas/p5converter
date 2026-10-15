#!/usr/bin/env python3
"""Erzeugt alle App-Icons (SVG-Quelle + PNG-Größen) für p5assets und p5converter nach demselben Muster.

Aufbau wie p5assets: abgerundetes Quadrat, dunkler Matrix-Regen, grüner leuchtender Poster-Rahmen im Hochformat
mit „p5_“. Unterschied: unten rechts ein Abzeichen – p5converter: zwei Pfeile ⇄, p5assets: Feuerball/Komet.
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

def badge(kind):
    """Abzeichen unten rechts (Mitte 380,380, Radius 96)."""
    cx, cy, r = 380, 380, 96
    base = (f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="#03160c" stroke="{GREEN}" stroke-width="10" filter="url(#glow)"/>')
    if kind == "converter":
        # zwei Pfeile ⇄
        a = (f'<g fill="none" stroke="{GREEN}" stroke-width="13" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow2)">'
             f'<path d="M{cx-48} {cy-22} H{cx+44} M{cx+18} {cy-48} L{cx+46} {cy-22} L{cx+18} {cy+4}"/>'
             f'<path d="M{cx+48} {cy+24} H{cx-44} M{cx-18} {cy-2} L{cx-46} {cy+24} L{cx-18} {cy+50}"/></g>')
        return base + a
    # Feuerball/Komet: Kopf rechts unten, Flammenschweif nach links oben
    hx, hy = cx + 20, cy + 20
    tail = (f'<path d="M{hx} {hy} C{hx-20} {hy-58} {hx-70} {hy-74} {hx-86} {hy-88} '
            f'C{hx-62} {hy-52} {hx-70} {hy-30} {hx-76} {hy-14} C{hx-56} {hy-24} {hx-42} {hy-6} {hx-62} {hy+22} '
            f'C{hx-34} {hy+10} {hx-22} {hy+30} {hx-30} {hy+50} C{hx-8} {hy+42} {hx+4} {hy+26} {hx} {hy} Z" '
            f'fill="url(#fire)" filter="url(#glow2)"/>')
    head = (f'<circle cx="{hx}" cy="{hy}" r="30" fill="url(#ball)" filter="url(#glow2)"/>'
            f'<circle cx="{hx+6}" cy="{hy+6}" r="12" fill="#eaffd8" fill-opacity=".85"/>')
    spark = ''.join(f'<circle cx="{x}" cy="{y}" r="{s}" fill="#b6ff6b"/>' for x, y, s in [(cx-62, cy+8, 4), (cx-40, cy-52, 3.5), (cx+4, cy-62, 3)])
    return base + tail + head + spark

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
<linearGradient id="fire" x1="1" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#eaffd8"/><stop offset=".35" stop-color="#7dff6b"/><stop offset=".8" stop-color="{GREEN}" stop-opacity=".55"/><stop offset="1" stop-color="{GREEN}" stop-opacity="0"/></linearGradient>
<radialGradient id="ball" cx=".4" cy=".4" r=".7"><stop offset="0" stop-color="#eaffd8"/><stop offset=".55" stop-color="#7dff6b"/><stop offset="1" stop-color="{GREEN}"/></radialGradient>
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
