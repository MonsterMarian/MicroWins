"""
Jednorázový úklid zdrojového obrázku loga -> `assets/logo_mark.png`.

Vygenerovaná předloha (`Creating_app_logo_for_microwins_*.jpeg`) měla dvě
pozadí pod sebou: vnější plátno s diagonálním přechodem a na něm nalepenou
zaoblenou dlaždici s vlastní světlou obrysovou linkou. Když se taková fotka
použije jako popředí adaptivní ikony, launcher pod ni podloží ještě svoji
barvu - a v ikoně je vidět čtvereček dlaždice na jinak barevném podkladu.
Přesně ten problém tenhle skript odstraňuje: vyřízne z fotky *jen* trofej
na průhledno, takže pozadí zůstane jedno jediné a řídí ho `BRAND_NAVY`
v `android-assets.mjs`.

Skript se nepouští při každém buildu - výstup je zaverzovaný v `assets/`.
Spouští se ručně jen při výměně předlohy:

    python scripts/extract-logo-mark.py <cesta-k-predloze.jpeg>

Potřebuje Pillow, numpy a scipy (nejsou v package.json, protože je zbytek
pipeline nepoužívá).
"""
import sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

SRC = sys.argv[1] if len(sys.argv) > 1 else "assets/logo_source.jpeg"
DST = "assets/logo_mark.png"

# Geometrie dlaždice v předloze, odměřená z hran ve zdrojovém obrázku.
# INSET stahuje masku za světlou obrysovou linku, ať z ní nezůstane oblouk v rohu.
TILE, RADIUS, INSET = (174, 174, 850, 850), 108, 16

rgb = np.asarray(Image.open(SRC).convert("RGB")).astype(np.float32)
H, W, _ = rgb.shape

mask = Image.new("L", (W, H), 0)
ImageDraw.Draw(mask).rounded_rectangle(
    [TILE[0] + INSET, TILE[1] + INSET, TILE[2] - INSET, TILE[3] - INSET],
    radius=RADIUS - INSET, fill=255)
tile = np.asarray(mask).astype(np.float32) / 255.0

# Barva dlaždice se odečítá z jejího okrajového pásu, ne z konstanty - tam
# trofej nezasahuje a přežije to i mírně jinak vygenerovanou předlohu.
ring = (tile > 0.5) & ~ndimage.binary_erosion(tile > 0.5, iterations=45)
bg = np.median(rgb[ring], axis=0)

dist = np.linalg.norm(rgb - bg, axis=2)
lum = rgb.mean(axis=2)
hi, lo = rgb.max(axis=2), rgb.min(axis=2)
sat = (hi - lo) / np.maximum(hi, 1.0)
ramp = lambda v, a, b: np.clip((v - a) / (b - a), 0, 1)

alpha = ramp(dist, 40.0, 74.0)
# Vržený stín je tmavší než dlaždice, kresba je vždy světlejší.
alpha[lum <= bg.mean() + 6] = 0.0
alpha *= tile

# Filtruje se po souvislých plochách, ne po pixelech. Plošný práh spolehlivě
# sundal smetí, ale zároveň ukusoval hrany kresby, kde barva přechází do
# pozadí a jas i sytost tím klesají. Celá plocha se rozhodne najednou, takže
# si trofej nechá hrany neporušené. Zahazují se dvě různá smetí:
#   - šedá záře nad kalichem: velká, ale nesytá,
#   - světlejší fleky v přechodu dlaždice: syté (tmavá modrá sytá je),
#     zato mnohem tmavší než kresba - nejtmavší plocha loga má jas 126,
#     tyhle fleky kolem 66.
solid = alpha > 0.5
labels, count = ndimage.label(solid, structure=np.ones((3, 3)))
keep = np.zeros(count + 1, bool)
for i, sl in enumerate(ndimage.find_objects(labels), start=1):
    blob = labels[sl] == i
    if blob.sum() <= 500:
        continue
    keep[i] = sat[sl][blob].mean() >= 0.18 and lum[sl][blob].mean() >= 95.0
alpha[~keep[labels]] = 0.0

# Zbytek záře drží na obrubě kalichu, takže ho filtr ploch nerozdělí. Pozná
# se ale podle měkkosti: kresba je vektorová a z průhledna do plné barvy
# přejde během dvou pixelů, kdežto záře se rozplývá přes desítky. Co leží
# dál než pár pixelů od plné plochy, není hrana kresby, ale mlha kolem ní.
# Světlý odlesk přímo na obrubě tím neutrpí - ten plné krytí má.
alpha *= ndimage.binary_dilation(alpha > 0.85, iterations=3)
alpha = ndimage.gaussian_filter(alpha, 0.5)

ys, xs = np.where(alpha > 0.06)
y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
crop, a = rgb[y0:y1, x0:x1], alpha[y0:y1, x0:x1, None]

# Poloprůhledné okraje nesou i barvu dlaždice - odečíst, jinak má logo
# na světlém podkladu tmavě modrý lem.
out = np.clip(np.where(a > 0.02, (crop - bg * (1 - a)) / np.maximum(a, 0.02), crop), 0, 255)
Image.fromarray(np.dstack([out, a[..., 0] * 255]).astype(np.uint8), "RGBA").save(DST)
print(f"{DST}: {x1 - x0}x{y1 - y0}, pozadí předlohy {tuple(bg.astype(int))}")
