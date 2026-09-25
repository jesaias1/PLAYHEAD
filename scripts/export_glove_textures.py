"""Export the shipped glove + knife cosmetic textures from the authoring sources.

WHY THIS EXISTS
    The drop-glove textures were originally shipped at 512x512 downscaled from
    1254x1254 authoring sheets. The glove itself occupies only a thin band of
    that sheet, so the shipped glove carried roughly 177 px of real vertical
    detail — visibly soft on a first-person viewmodel where the glove is
    magnified. This script produces a second, sharper 1024x1024 variant that the
    HIGH and ULTRA quality tiers select, while LOW and MEDIUM keep the light 512.

SOURCE MAPPING IS VERIFIED, NOT ASSUMED
    `--verify` infers which source PNG each shipped file came from by downscaling
    every source and measuring the pixel difference, so a mislabelled export
    cannot slip through. Run it before exporting.

REQUIREMENTS
    Pillow (`pip install Pillow`). Matches the existing
    `scripts/export_glove_template.py` tooling convention.

USAGE
    python scripts/export_glove_textures.py --verify
    python scripts/export_glove_textures.py --export

The sources are authoring inputs and are NOT part of the runtime bundle.
"""

from __future__ import annotations

import argparse
import os
import sys

from PIL import Image, ImageChops, ImageStat

# --- Authoring sources (outside the repo; never shipped) --------------------
GLOVE_SOURCE_DIR = r"C:\Users\lin4s\Downloads\PLAYHEAD GLOVE TEXTURES"
KNIFE_SOURCE_DIR = r"C:\Users\lin4s\Downloads\PLAYHEAD KNIFE TEXTURES"

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GLOVE_DROP_DIR = os.path.join(REPO, "public", "assets", "viewmodel", "gloves", "drops")
GLOVE_HI_DIR = os.path.join(GLOVE_DROP_DIR, "hi")
KNIFE_TEXTURE_DIR = os.path.join(REPO, "public", "assets", "viewmodel", "karambit", "textures")

# --- The shipped catalog ---------------------------------------------------
# CYBER II was removed from production: it read too similarly to CYBER.
# Verified mapping (source PNG -> shipped name) from `--verify`.
STANDARD_SIZE = 512
HI_SIZE = 1024
HI_QUALITY = 90
KNIFE_QUALITY = 88

GLOVE_SOURCES: dict[str, str] = {
    "CREME.png": "creme.webp",
    "CRYSTAL.png": "crystal.webp",
    "CYBER.png": "cyber.webp",
    "CYBER FULL.png": "cyber-full.webp",
    "GOLDINE.png": "aureate.webp",
    "GOLDLINE FULL.png": "aureate-full.webp",
    "PEARL 2.png": "pearl-ice.webp",
    "PEARL.png": "pearl.webp",
    "SILVERSKIN.png": "silverskin.webp",
    "SYNTH.png": "synth.webp",
    "SYNTH FULL.png": "synth-full.webp",
}

# Removed from production. Listed so `--verify` reports it rather than silently
# ignoring an unexpected file.
REMOVED_GLOVES = {"cyber-2.webp": "CYBER 2.png"}

KNIFE_SOURCES: dict[str, str] = {
    "BLUE GEM.png": "blue_gem_cosmic.webp",
}


def load_sources(directory: str, names: list[str]) -> dict[str, Image.Image]:
    out: dict[str, Image.Image] = {}
    for name in names:
        path = os.path.join(directory, name)
        if not os.path.exists(path):
            print(f"  MISSING SOURCE: {path}", file=sys.stderr)
            continue
        out[name] = Image.open(path).convert("RGB")
    return out


def verify() -> int:
    """Prove the source -> shipped mapping by pixel difference."""
    sources = load_sources(GLOVE_SOURCE_DIR, list(GLOVE_SOURCES) + list(REMOVED_GLOVES.values()))
    if not sources:
        print("no glove sources found", file=sys.stderr)
        return 1

    failures = 0
    print(f"{'shipped':<22} {'expected source':<20} {'diff':>7}  {'runner-up':<20} {'diff':>7}")
    for src_name, shipped_name in list(GLOVE_SOURCES.items()) + list(REMOVED_GLOVES.items()):
        shipped_path = os.path.join(GLOVE_DROP_DIR, shipped_name)
        if not os.path.exists(shipped_path):
            print(f"{shipped_name:<22} (not shipped)")
            continue
        target = Image.open(shipped_path).convert("RGB")
        scored = []
        for candidate, img in sources.items():
            small = img.resize(target.size, Image.LANCZOS)
            mean = sum(ImageStat.Stat(ImageChops.difference(small, target)).mean) / 3.0
            scored.append((mean, candidate))
        scored.sort()
        best, second = scored[0], scored[1]
        ok = best[1] == src_name
        failures += 0 if ok else 1
        print(
            f"{shipped_name:<22} {src_name:<20} {best[0]:>7.2f}  "
            f"{second[1]:<20} {second[0]:>7.2f}  {'OK' if ok else 'MISMATCH'}"
        )
    print(f"\n{'all mappings verified' if failures == 0 else f'{failures} MISMATCH(ES)'}")
    return 0 if failures == 0 else 1


def export() -> int:
    os.makedirs(GLOVE_HI_DIR, exist_ok=True)

    gloves = load_sources(GLOVE_SOURCE_DIR, list(GLOVE_SOURCES))
    for src_name, shipped_name in GLOVE_SOURCES.items():
        img = gloves.get(src_name)
        if img is None:
            continue
        hi = img.resize((HI_SIZE, HI_SIZE), Image.LANCZOS)
        out = os.path.join(GLOVE_HI_DIR, shipped_name)
        hi.save(out, "WEBP", quality=HI_QUALITY, method=6)
        print(f"  {shipped_name:<22} -> hi/ {HI_SIZE}x{HI_SIZE}  {os.path.getsize(out) / 1024:.1f} KB")

    knives = load_sources(KNIFE_SOURCE_DIR, list(KNIFE_SOURCES))
    for src_name, shipped_name in KNIFE_SOURCES.items():
        img = knives.get(src_name)
        if img is None:
            continue
        out = os.path.join(KNIFE_TEXTURE_DIR, shipped_name)
        img.resize((HI_SIZE, HI_SIZE), Image.LANCZOS).save(
            out, "WEBP", quality=KNIFE_QUALITY, method=6
        )
        print(f"  {shipped_name:<22} ->      {HI_SIZE}x{HI_SIZE}  {os.path.getsize(out) / 1024:.1f} KB")

    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify", action="store_true", help="verify source -> shipped mapping")
    parser.add_argument("--export", action="store_true", help="export the hi-resolution variants")
    args = parser.parse_args()
    if not args.verify and not args.export:
        parser.print_help()
        return 1
    if args.verify:
        return verify()
    return export()


if __name__ == "__main__":
    raise SystemExit(main())
