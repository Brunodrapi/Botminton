"""Extrait les sprites de la planche RG-B1 (assets/rg-b1-sheet.png) vers un atlas assets/rg-b1.png + assets/rg-b1.json.

Étapes par cellule : masque « fond crème » → remplissage depuis les bords → plus grande composante connexe
→ réduction d'un facteur unique → requantification sur une petite palette → ancrage aux pieds.
"""
import json, sys
from collections import deque
import numpy as np
from PIL import Image

DEBUG = len(sys.argv) > 1 and sys.argv[1] == '--debug'
FACTOR = 5.75        # réduction commune à toutes les planches (RG-B1 de face = 32 px)

SHEETS = {
    'rg-b1': dict(src='assets/rg-b1-sheet.png', rows=[(178, 392, 0, 1536), (478, 712, 0, 1536), (786, 965, 0, 870)], obj=(884, 770, 1150, 965)),
    'bw-01': dict(src='assets/bw-01-sheet.png', rows=[(172, 352, 0, 1536), (452, 662, 0, 1536), (742, 915, 0, 870)], obj=(884, 710, 1140, 918)),
    'rg-03': dict(src='assets/rg-03-sheet.png', rows=[(174, 372, 0, 1536), (470, 690, 0, 1536), (762, 935, 0, 870)], obj=(884, 735, 1140, 935)),
    'zg-04': dict(src='assets/zg-04-sheet.png', rows=[(174, 376, 0, 1536), (468, 685, 0, 1536), (758, 935, 0, 870)], obj=(884, 730, 1140, 935)),
}
ROW_NAMES = [
    ['face', 'back', 'side_l', 'side_r', 'idle', 'walk1', 'walk2', 'run1', 'run2'],
    ['prep', 'hit_low', 'hit_mid', 'hit_high', 'follow', 'smash_prep', 'jump', 'smash_hit', 'land'],
    ['serve', 'receive', 'miss', 'win', 'lose'],
]

im = None
H = W = 0

def bg_mask(cell):
    """Pixels de fond : proches du crème local, ou gris clair (ombre au sol)."""
    r, g, b = cell[..., 0], cell[..., 1], cell[..., 2]
    sat = cell.max(axis=2) - cell.min(axis=2)
    lum = cell.mean(axis=2)
    # crème du fond (avec vignettage) : clair, légèrement jaune, peu saturé
    near = (r >= 178) & (g >= 178) & (b >= 155) & (r - b >= 4) & (r - b <= 48) & (sat < 48)
    greyish = (sat < 22) & (lum > 125) & (lum < 205)   # ombre portée au sol
    return near | greyish

def flood_outside(mask):
    h, w = mask.shape
    out = np.zeros_like(mask, dtype=bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if mask[y, x] and not out[y, x]: out[y, x] = True; q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if mask[y, x] and not out[y, x]: out[y, x] = True; q.append((y, x))
    while q:
        y, x = q.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not out[ny, nx]:
                out[ny, nx] = True; q.append((ny, nx))
    return out

def dilate(m, n):
    out = m.copy()
    for _ in range(n):
        out = out | np.roll(out, 1, 0) | np.roll(out, -1, 0) | np.roll(out, 1, 1) | np.roll(out, -1, 1)
    return out

def sprite_mask(cell):
    """Contours fermés par dilatation avant le remplissage : l'intérieur des raquettes (couleur du fond) reste."""
    fg0 = ~bg_mask(cell)
    fgd = dilate(fg0, 2)
    fgd[0, :] = fgd[-1, :] = False; fgd[:, 0] = fgd[:, -1] = False
    outside = flood_outside(~fgd)
    outside = dilate(outside, 2) & ~fg0
    return ~outside

def largest_component(fg):
    h, w = fg.shape
    label = np.zeros((h, w), dtype=np.int32)
    best, best_n, cur = 0, 0, 0
    for y in range(h):
        for x in range(w):
            if fg[y, x] and not label[y, x]:
                cur += 1; n = 0
                q = deque([(y, x)]); label[y, x] = cur
                while q:
                    cy, cx = q.popleft(); n += 1
                    for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1), (cy - 1, cx - 1), (cy + 1, cx + 1), (cy - 1, cx + 1), (cy + 1, cx - 1)):
                        if 0 <= ny < h and 0 <= nx < w and fg[ny, nx] and not label[ny, nx]:
                            label[ny, nx] = cur; q.append((ny, nx))
                if n > best_n: best, best_n = cur, n
    return label == best

def split_cells(band, expected=None):
    """Découpe une bande en cellules selon les colonnes occupées (lignes fines ignorées)."""
    y0, y1, bx0, bx1 = band
    strip = im[y0:y1].copy()
    strip[:, :bx0] = 0; strip[:, bx1:] = 0
    strip[:, :bx0, :] = (215, 213, 192); strip[:, bx1:, :] = (215, 213, 192)
    fg = ~bg_mask(strip)
    # érosion horizontale : supprime les séparateurs verticaux fins
    er = fg.copy()
    for k in (1, 2, 3, 4, 5):
        er &= np.roll(fg, k, axis=1) & np.roll(fg, -k, axis=1)
    cols = er.sum(axis=0) > 4
    cells, start = [], None
    for x in range(W + 1):
        on = x < W and cols[x]
        if on and start is None: start = x
        if not on and start is not None:
            if x - start > 25 and er[:, start:x].sum() > 400: cells.append((start, x))
            start = None
    # fusionne les runs séparés par un petit trou (< 12 px)
    merged = []
    for c in cells:
        if merged and c[0] - merged[-1][1] < 12: merged[-1] = (merged[-1][0], c[1])
        else: merged.append(c)
    # trop de runs (bulle, volant décoratif séparé du robot) : on fusionne les plus proches
    while expected and len(merged) > expected:
        gaps = [merged[i + 1][0] - merged[i][1] for i in range(len(merged) - 1)]
        i = gaps.index(min(gaps))
        merged[i:i + 2] = [(merged[i][0], merged[i + 1][1])]
    # chaque colonne appartient à la cellule la plus proche : les structures fines (raquettes) restent dans leur cellule
    bounds = [bx0] + [(merged[i - 1][1] + merged[i][0]) // 2 for i in range(1, len(merged))] + [bx1]
    return [(bounds[i], bounds[i + 1]) for i in range(len(merged))]

def extract(x0, y0, x1, y1):
    pad = 4
    x0, y0, x1, y1 = max(0, x0), max(0, y0 - pad), min(W, x1), min(H, y1 + pad)
    cell = im[y0:y1, x0:x1]
    fg = largest_component(sprite_mask(cell))
    ys, xs = np.where(fg)
    bx0, bx1, by0, by1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    rgb = cell[by0:by1, bx0:bx1]
    alpha = fg[by0:by1, bx0:bx1]
    # ancre : centre des pieds (15 % du bas)
    feet = alpha[int(alpha.shape[0] * 0.85):]
    fy, fx = np.where(feet)
    ax = float(fx.mean()) if len(fx) else alpha.shape[1] / 2
    return rgb, alpha, ax

def downscale(rgb, alpha, f):
    h, w = alpha.shape
    nh, nw = max(1, round(h / f)), max(1, round(w / f))
    a = alpha.astype(np.float32)
    prem = rgb.astype(np.float32) * a[..., None]
    ai = Image.fromarray((a * 255).astype(np.uint8)).resize((nw, nh), Image.BOX)
    pi = Image.fromarray(np.clip(prem, 0, 255).astype(np.uint8)).resize((nw, nh), Image.BOX)
    a2 = np.array(ai).astype(np.float32) / 255
    p2 = np.array(pi).astype(np.float32)
    rgb2 = np.where(a2[..., None] > 0.02, p2 / np.maximum(a2[..., None], 0.02), 0)
    keep = a2 >= 0.45
    return rgb2, keep

def kmeans(pixels, k, iters=12, seed=None):
    rng = np.random.default_rng(1)
    if seed is None: seed = pixels[rng.choice(len(pixels), k, replace=False)]
    c = seed.astype(np.float32).copy()
    for _ in range(iters):
        d = ((pixels[:, None, :] - c[None]) ** 2).sum(axis=2)
        lab = d.argmin(axis=1)
        for i in range(k):
            sel = pixels[lab == i]
            if len(sel): c[i] = sel.mean(axis=0)
    return c

# ---------------------------------------------------------------- extraction
def extract_sheet(key, cfg):
  global im, H, W
  im = np.array(Image.open(cfg['src']).convert('RGB')).astype(np.int16)
  H, W, _ = im.shape
  sprites = {}
  for band, names in zip(cfg['rows'], ROW_NAMES):
    cells = split_cells(band, len(names))
    if len(cells) != len(names):
        print(key, 'bande', band, ':', len(cells), 'cellules trouvées pour', len(names), 'noms', cells)
    for name, (cx0, cx1) in zip(names, cells):
        sprites[name] = extract(cx0, band[0], cx1, band[1])
  # volants : composantes du panneau objets, on garde celle du haut à gauche
  ox0, oy0, ox1, oy1 = cfg['obj']
  cell = im[oy0:oy1, ox0:ox1]
  fg = sprite_mask(cell)
  # composante dont le centre est le plus en haut à gauche
  h, w = fg.shape
  label = np.zeros((h, w), dtype=np.int32); comps = []; cur = 0
  for y in range(h):
      for x in range(w):
          if fg[y, x] and not label[y, x]:
              cur += 1; q = deque([(y, x)]); label[y, x] = cur; pts = []
              while q:
                  cy, cx = q.popleft(); pts.append((cy, cx))
                  for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                      if 0 <= ny < h and 0 <= nx < w and fg[ny, nx] and not label[ny, nx]:
                          label[ny, nx] = cur; q.append((ny, nx))
              if len(pts) > 300: comps.append((cur, pts))
  comps.sort(key=lambda c: min(p[1] for p in c[1]) + min(p[0] for p in c[1]))
  cid, pts = comps[0]
  m = label == cid
  ys, xs = np.where(m)
  srgb = cell[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
  salpha = m[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
  sprites['shuttle'] = (srgb, salpha, salpha.shape[1] / 2)

  f = FACTOR

  # palette commune (k-means sur tous les pixels réduits)
  reduced = {}
  allpx = []
  for name, (rgb, alpha, ax) in sprites.items():
      rgb2, keep = downscale(rgb, alpha, f if name != 'shuttle' else f * 0.8)
      reduced[name] = (rgb2, keep, ax / (f if name != 'shuttle' else f * 0.8))
      allpx.append(rgb2[keep])
  allpx = np.concatenate(allpx)
  pal = kmeans(allpx.astype(np.float32), 10)
  pal = np.clip(np.round(pal), 0, 255).astype(np.uint8)

  # ---------------------------------------------------------------- atlas
  entries = {}
  tiles = []
  for name, (rgb2, keep, ax) in reduced.items():
      px = rgb2.reshape(-1, 3).astype(np.float32)
      d = ((px[:, None, :] - pal[None].astype(np.float32)) ** 2).sum(axis=2)
      q = pal[d.argmin(axis=1)].reshape(rgb2.shape)
      h, w = keep.shape
      tile = np.zeros((h, w, 4), dtype=np.uint8)
      tile[..., :3] = q
      tile[..., 3] = keep * 255
      tiles.append((name, tile, ax))

  x, y, rowh = 0, 0, 0
  AW = 256
  for name, tile, ax in tiles:
      h, w = tile.shape[:2]
      if x + w > AW: x = 0; y += rowh + 1; rowh = 0
      entries[name] = {'x': x, 'y': y, 'w': int(w), 'h': int(h), 'ax': int(round(ax)), 'ay': int(h)}
      x += w + 1; rowh = max(rowh, h)
  AH = y + rowh + 1
  atlas = np.zeros((AH, AW, 4), dtype=np.uint8)
  for name, tile, ax in tiles:
      e = entries[name]
      atlas[e['y']:e['y'] + e['h'], e['x']:e['x'] + e['w']] = tile
  Image.fromarray(atlas).save(f'assets/{key}.png')
  json.dump(entries, open(f'assets/{key}.json', 'w'), indent=0)
  print(key, 'palette', [('#%02x%02x%02x' % tuple(c)) for c in pal])
  print(key, 'atlas', AW, 'x', AH, ' '.join(f"{n}:{e['w']}x{e['h']}" for n, e in entries.items()))
  if DEBUG:
      big = Image.fromarray(atlas).resize((AW * 4, AH * 4), Image.NEAREST)
      bg = Image.new('RGBA', big.size, (60, 120, 90, 255)); bg.alpha_composite(big)
      bg.save(f'/tmp/claude-0/-home-user-Botminton/c2453339-d317-59ec-a813-e906198af948/scratchpad/atlas_{key}.png')
  return entries, atlas


# ---------------------------------------------------------------- module JS embarqué (aucun chargement réseau)
import base64, io
js = "/* Généré par tools/extract_sprites.py à partir des planches assets/*-sheet.png — ne pas éditer à la main. */\n"
js += "window.SPRITE_ATLAS = {\n"
for key, cfg in SHEETS.items():
    entries, atlas = extract_sheet(key, cfg)
    buf = io.BytesIO(); Image.fromarray(atlas).save(buf, format='PNG')
    b64 = base64.b64encode(buf.getvalue()).decode('ascii')
    js += "  '" + key + "': { frames: " + json.dumps(entries, separators=(',', ':')) + ",\n    png: 'data:image/png;base64," + b64 + "' },\n"
js += "};\n"
open('src/sprites.js', 'w').write(js)
print('src/sprites.js', len(js) // 1024, 'KB')
