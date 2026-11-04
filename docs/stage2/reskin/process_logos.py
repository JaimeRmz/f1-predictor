"""Normalise the raw team logos in frontend/f1teams26 into frontend/public/teams/<id>.png.
Trim transparent margins, remove baked-in white/checkerboard backgrounds (Ferrari, Red Bull), downscale to
<=160x120 (the UI never shows them above ~44 px). Run from repo root: python docs/stage2/reskin/process_logos.py"""
from PIL import Image, ImageChops
import collections, os
SRC, DST = "frontend/f1teams26", "frontend/public/teams"
MAP = {"Alpine.png": "alpine", "Aston Martin.png": "aston-martin", "Audi.png": "audi", "Cadilac.png": "cadillac",
       "Ferrari.jpg": "ferrari", "Haas.png": "haas", "Mclaren.png": "mclaren", "Mercedes.png": "mercedes",
       "Racing Bulls.png": "racing-bulls", "Redbull.png": "red-bull", "Williams.png": "williams"}
OPAQUE_BG = {"ferrari", "red-bull"}   # white + grey checkerboard baked into the pixels

def knock_out_bg(im):
    """Flood-fill from the border over light, unsaturated pixels (white and checkerboard grey) -> transparent."""
    px = im.load(); w, h = im.size
    def bg(p): r, g, b, _ = p; return min(r, g, b) > 170 and max(r, g, b) - min(r, g, b) < 24
    seen = set(); q = collections.deque((x, y) for x in range(w) for y in (0, h - 1)) 
    q.extend((x, y) for y in range(h) for x in (0, w - 1))
    while q:
        x, y = q.popleft()
        if (x, y) in seen or not (0 <= x < w and 0 <= y < h) or not bg(px[x, y]): continue
        seen.add((x, y)); px[x, y] = (0, 0, 0, 0)
        q.extend(((x+1, y), (x-1, y), (x, y+1), (x, y-1)))
    return im

LIGHTEN = {"cadillac"}                # dark-on-transparent mark: invert RGB so it reads on the dark UI

for fn, tid in MAP.items():
    im = Image.open(os.path.join(SRC, fn)).convert("RGBA")
    if tid in OPAQUE_BG: im = knock_out_bg(im)
    if tid in LIGHTEN:
        r, g, b, a = im.split(); inv = [r.point(lambda v: 255 - v), g.point(lambda v: 255 - v), b.point(lambda v: 255 - v)]
        im = Image.merge("RGBA", (*inv, a))
    bbox = im.getchannel("A").point(lambda v: 255 if v > 12 else 0).getbbox()
    if bbox: im = im.crop(bbox)
    im.thumbnail((160, 120), Image.LANCZOS)
    im.save(os.path.join(DST, tid + ".png"), optimize=True)
    print(f"{tid:13s} {im.size} {os.path.getsize(os.path.join(DST, tid + '.png'))//1024} KB")
