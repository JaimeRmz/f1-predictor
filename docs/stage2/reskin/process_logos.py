"""Normalise the raw team logos in frontend/f1teams26 into frontend/public/teams/<id>.png.

Run from the repo root:  python docs/stage2/reskin/process_logos.py
Writes the logos and docs/stage2/reskin/logo-fringe-check.png (every logo on the card / table-row colours, 400%).

Steps per logo
  1. Opaque originals (Ferrari.jpg, Redbull.png) carry a white + light-grey checkerboard baked into the pixels. The
     background is keyed out (soft: per-pixel matte colour), then edge pixels are DECONTAMINATED: each partially covered
     pixel is un-mixed from its local matte colour (c = a*F + (1-a)*M) so no white/grey fringe stays in the colour.
  2. Optional lighter variant for logos that are dark/thin on the dark UI (Alpine, Racing Bulls, Aston Martin, Cadillac).
  3. Trim, then downscale to <=160x120 in PREMULTIPLIED alpha (PIL 'RGBa'), which is what stops transparent-black
     matte pixels bleeding a dark/light halo into the edges when shrinking.
"""
import os
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

SRC, DST, DOCS = "frontend/f1teams26", "frontend/public/teams", "docs/stage2/reskin"
MAP = {"Alpine.png": "alpine", "Aston Martin.png": "aston-martin", "Audi.png": "audi", "Cadilac.png": "cadillac",
       "Ferrari.jpg": "ferrari", "Haas.png": "haas", "Mclaren.png": "mclaren", "Mercedes.png": "mercedes",
       "Racing Bulls.png": "racing-bulls", "Redbull.png": "red-bull", "Williams.png": "williams"}

# How the matte is found. "global": every light, unsaturated pixel is background (the Red Bull mark has no white
# fill, so enclosed counters and gaps are background too). "flood": only background connected to the border
# (Ferrari: the white stripe of the flag on the shield must survive).
OPAQUE_BG = {"red-bull": "global", "ferrari": "flood"}
LIGHTEN = {"cadillac": "invert", "alpine": 0.5, "racing-bulls": 0.6, "aston-martin": 0.85}   # k: c + (255-c)*k
LOGO_MAX = (160, 120)


def light_unsaturated(rgb):
    r, g, b = rgb[..., 0].astype(int), rgb[..., 1].astype(int), rgb[..., 2].astype(int)
    return (np.minimum(np.minimum(r, g), b) > 165) & ((np.maximum(np.maximum(r, g), b) - np.minimum(np.minimum(r, g), b)) < 26)


def key_out(im, mode):
    rgb = np.asarray(im.convert("RGB")).astype(float)
    cand = light_unsaturated(rgb)
    if mode == "flood":
        lab, _ = ndi.label(cand)
        border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
        bg = np.isin(lab, border[border > 0])
    else:
        bg = cand
    bg = ndi.binary_opening(bg, iterations=1) | ndi.binary_erosion(bg, iterations=1)   # drop 1-px specks of "background"
    # Pure foreground = at least 3 px away from the matte; edge band = the ring in between.
    d_bg = ndi.distance_transform_edt(~bg)
    pure = d_bg > 3
    edge = (~bg) & (~pure)
    # Nearest pure-foreground colour F and nearest matte colour M for every pixel.
    _, fi = ndi.distance_transform_edt(~pure, return_indices=True)
    _, mi = ndi.distance_transform_edt(~bg, return_indices=True)
    F = rgb[fi[0], fi[1]]
    M = rgb[mi[0], mi[1]]
    out_rgb = rgb.copy()
    alpha = np.where(bg, 0.0, 1.0)
    fm = F - M
    den = (fm ** 2).sum(-1)
    a = np.clip(((rgb - M) * fm).sum(-1) / np.maximum(den, 1e-6), 0, 1)
    a = np.where(den < 900, 1.0, a)                       # foreground ~ matte colour: cannot un-mix, keep opaque
    # Soft edge: alpha from the un-mix, but never below a floor right next to pure foreground (keeps stroke weight).
    alpha = np.where(edge, np.clip(a * 1.08, 0, 1), alpha)
    out_rgb = np.where(edge[..., None], F, out_rgb)       # decontaminate: edge pixels take the pure foreground colour
    alpha = np.where(alpha < 0.06, 0.0, alpha)
    return Image.fromarray(np.dstack([out_rgb, alpha * 255]).astype(np.uint8), "RGBA")


def lighten(im, how):
    a = im.getchannel("A")
    rgb = np.asarray(im.convert("RGB")).astype(float)
    rgb = 255 - rgb if how == "invert" else rgb + (255 - rgb) * how
    out = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB").convert("RGBA")
    out.putalpha(a)
    return out


def shrink(im, box):
    """Premultiplied resize: transparent pixels carry no colour, so edges cannot pick up a halo."""
    im = im.copy()
    im.thumbnail(box, Image.LANCZOS) if im.mode != "RGBA" else None
    if im.mode == "RGBA":
        w, h = im.size
        s = min(box[0] / w, box[1] / h, 1.0)
        if s < 1:
            im = im.convert("RGBa").resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS).convert("RGBA")
    return im


os.makedirs(DST, exist_ok=True)
finals = {}
for fn, tid in MAP.items():
    im = Image.open(os.path.join(SRC, fn)).convert("RGBA")
    if tid in OPAQUE_BG:
        im = key_out(im, OPAQUE_BG[tid])
    if tid in LIGHTEN:
        im = lighten(im, LIGHTEN[tid])
    bbox = im.getchannel("A").point(lambda v: 255 if v > 12 else 0).getbbox()
    if bbox:
        im = im.crop(bbox)
    im = shrink(im, LOGO_MAX)
    im.save(os.path.join(DST, tid + ".png"), optimize=True)
    finals[tid] = im
    print(f"{tid:13s} {im.size} {os.path.getsize(os.path.join(DST, tid + '.png')) // 1024} KB")

# Fringe check: each logo at the sizes the UI uses (top-3 card 34 px tall, table row 22 px), on the real card and row
# colours, enlarged 400% with nearest-neighbour so any light/dark halo is plain to see.
CARD, ROW = (13, 20, 32), (17, 19, 23)
cells = []
for tid, im in finals.items():
    for h, bgc in ((34, CARD), (22, ROW)):
        w = max(1, round(im.width * h / im.height))
        w, hh = (min(w, round(h * 1.35)), h) if w > h * 1.35 else (w, h)
        small = im.convert("RGBa").resize((w, max(1, round(im.height * w / im.width))), Image.LANCZOS).convert("RGBA")
        tile = Image.new("RGB", (round(34 * 1.35), 34), bgc)
        tile.paste(small, ((tile.width - small.width) // 2, (tile.height - small.height) // 2), small)
        cells.append((tid, h, tile.resize((tile.width * 4, tile.height * 4), Image.NEAREST)))
cw, ch = cells[0][2].size
cols = 4
sheet = Image.new("RGB", (cols * (cw + 8) + 8, ((len(cells) + cols - 1) // cols) * (ch + 8) + 8), (40, 40, 44))
for i, (_, _, t) in enumerate(cells):
    sheet.paste(t, (8 + (i % cols) * (cw + 8), 8 + (i // cols) * (ch + 8)))
sheet.save(os.path.join(DOCS, "logo-fringe-check.png"))
print("fringe sheet:", [f"{t}@{h}" for t, h, _ in cells][:8], "...")
