#!/usr/bin/env python3
"""
MASTERY GLOVE — TEXTURE TEMPLATE EXPORT (authoring tool, never shipped).

Produces, in `art-source/glove/`:

    glove_texture_template.png    the exact authored arms atlas, at native size
    glove_uv_guide.png            the same sheet with a UV grid + region overlay
    glove_mask_candidate.png      a FIRST-PASS shared glove mask
    README.txt                    the documented facts below

NOTHING IN `public/` IS MODIFIED. This tool only reads the shipped asset and
writes authoring artefacts outside the runtime path.

REQUIREMENT:  pip install pillow numpy
    (The repository intentionally has no image library at runtime; this is an
     offline authoring tool.)

USAGE:
    python scripts/export_glove_template.py
"""

import os
import sys

try:
    from PIL import Image, ImageDraw
    import numpy as np
except ImportError:  # pragma: no cover - tooling guard
    sys.exit("This authoring tool needs Pillow and numpy:  pip install pillow numpy")

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(REPO, "public", "assets", "viewmodel", "textures", "arms_gloves_01.webp")
OUT_DIR = os.path.join(REPO, "art-source", "glove")

# A glove pixel is dark AND desaturated. Skin is warm and strongly saturated.
GLOVE_MAX_LUMINANCE = 90
GLOVE_MAX_SATURATION = 18


def main() -> None:
    if not os.path.exists(BASE):
        sys.exit(f"Base texture not found: {BASE}")

    os.makedirs(OUT_DIR, exist_ok=True)
    base = Image.open(BASE).convert("RGB")
    width, height = base.size
    pixels = np.asarray(base).astype(np.int16)

    # ---- 1. Native template -------------------------------------------------
    template_path = os.path.join(OUT_DIR, "glove_texture_template.png")
    base.save(template_path)

    # ---- 2. UV guide --------------------------------------------------------
    guide = base.copy()
    draw = ImageDraw.Draw(guide)
    step = width // 8
    for x in range(0, width + 1, step):
        draw.line([(x, 0), (x, height)], fill=(0, 255, 255), width=1)
        draw.text((x + 3, 3), str(x), fill=(0, 255, 255))
    for y in range(0, height + 1, step):
        draw.line([(0, y), (width, y)], fill=(0, 255, 255), width=1)
        draw.text((3, y + 3), str(y), fill=(0, 255, 255))
    # V runs bottom-up in the shader because flipY = false, so label the axis.
    draw.text((3, height - 14), "V=1 (bottom in texture space)", fill=(255, 255, 0))
    draw.text((3, 16), "V=0 (top in texture space)", fill=(255, 255, 0))
    guide_path = os.path.join(OUT_DIR, "glove_uv_guide.png")
    guide.save(guide_path)

    # ---- 3. First-pass shared glove mask -----------------------------------
    r = pixels[:, :, 0]
    g = pixels[:, :, 1]
    b = pixels[:, :, 2]
    maxc = pixels.max(axis=2).astype(np.float32)
    minc = pixels.min(axis=2).astype(np.float32)
    luminance = pixels.mean(axis=2)
    saturation = np.where(maxc > 0, (maxc - minc) / np.maximum(maxc, 1) * 100.0, 0.0)

    glove = (luminance < GLOVE_MAX_LUMINANCE) & (saturation < GLOVE_MAX_SATURATION)
    mask = np.where(glove, 255, 0).astype(np.uint8)
    mask_path = os.path.join(OUT_DIR, "glove_mask_candidate.png")
    Image.fromarray(mask, mode="L").save(mask_path)

    # ---- 4. Documented facts ------------------------------------------------
    skin_fraction = float(((r > 90) & (r < 235) & (r > b + 25) & (g > b) & (g < r)).mean())
    glove_fraction = float(glove.mean())

    readme = f"""MASTERY GLOVE TEXTURE — AUTHORING NOTES
=======================================

SOURCE (do not modify)
  path        public/assets/viewmodel/textures/arms_gloves_01.webp
  dimensions  {width} x {height}
  mode        RGB (fully opaque; alpha is not used)
  encoding    WebP, lossless

MESH / UV
  model       public/assets/viewmodel/arms/arms_rig.glb
  material    1 material ("Arms"), 1 mesh, 1 primitive
  UV set      TEXCOORD_0 (the only one)
  IMPORTANT   the UV layout is shared by BOTH hands/forearms. Do not invent or
              redraw UVs: paint onto the existing sheet.

WHAT THE SHEET CONTAINS
  exposed skin/forearm/hand pixels   ~{skin_fraction * 100:.1f}% of the sheet
  glove-region pixels (dark, desat)  ~{glove_fraction * 100:.1f}% of the sheet

  So a glove skin must PRESERVE the non-glove skin areas. Painting the whole
  sheet a glove material would repaint human skin.

FLIP / COLOUR SPACE
  flipY        FALSE. The GLB is authored with flipped V, so V=0 is the TOP of
               the image file and V=1 is the BOTTOM. Author artwork the way the
               template looks; do not pre-flip it.
  colourSpace  sRGB for base colour. If you supply a data mask it must be
               LINEAR (NoColorSpace) - see the mask note below.
  filtering    minFilter LinearMipmapLinear, magFilter NEAREST (sharp retro PSX
               texel look). Keep hard pixel edges; avoid soft gradients that
               disappear under nearest magnification.
  wrapping     ClampToEdge on both axes.

PRODUCTION SIZE
  512-1024 px maximum dimension. The shipped sheet is {width}x{height} and is
  already correct; do not ship larger.

OUTPUT LOCATION AND FORMAT
  public/assets/viewmodel/gloves/<glove>.webp
    standard_issue.webp    (optional: the base sheet is the canonical fallback)
    first_contact.webp
    signal_runner.webp
    velocity.webp
    goldline.webp
    diamond_hand.webp
    signal_master.webp
  Missing files fall back safely to the base sheet, so you can ship them one at
  a time.

TREATMENTS STILL APPLY
  Each glove ALSO applies material parameters (roughness, metalness, emissive,
  audio response). Your texture supplies PATTERN; the treatment supplies
  MATERIAL. Goldline, for example, is a dark premium base with thin gold
  tracing - not a solid gold sheet.

SHARED GLOVE MASK (optional, recommended)
  path        public/assets/viewmodel/gloves/glove_mask.webp
  encoding    greyscale, WHITE = glove, BLACK = skin, LINEAR colour space
  size        same as the base sheet
  effect      metalness and roughness are scoped to white pixels only, so
              exposed skin is never made metallic.

  `glove_mask_candidate.png` in this folder is a FIRST PASS derived from
  luminance and saturation. It is a starting point for hand refinement, NOT
  final artwork. To activate it: convert to WebP, copy it to the path above, and
  reload. With no mask present the pipeline is a no-op.
"""

    with open(os.path.join(OUT_DIR, "README.txt"), "w", encoding="utf-8") as handle:
        handle.write(readme)

    print(f"[GLOVE-TEMPLATE] base {width}x{height} | skin ~{skin_fraction * 100:.1f}% | glove ~{glove_fraction * 100:.1f}%")
    print(f"[GLOVE-TEMPLATE] wrote {os.path.relpath(template_path, REPO)}")
    print(f"[GLOVE-TEMPLATE] wrote {os.path.relpath(guide_path, REPO)}")
    print(f"[GLOVE-TEMPLATE] wrote {os.path.relpath(mask_path, REPO)}")
    print(f"[GLOVE-TEMPLATE] wrote {os.path.relpath(os.path.join(OUT_DIR, 'README.txt'), REPO)}")
    print("[GLOVE-TEMPLATE] nothing under public/ was modified")


if __name__ == "__main__":
    main()
