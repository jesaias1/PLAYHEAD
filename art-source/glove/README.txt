MASTERY GLOVE TEXTURE — AUTHORING NOTES
=======================================

SOURCE (do not modify)
  path        public/assets/viewmodel/textures/arms_gloves_01.webp
  dimensions  512 x 512
  mode        RGB (fully opaque; alpha is not used)
  encoding    WebP, lossless

MESH / UV
  model       public/assets/viewmodel/arms/arms_rig.glb
  material    1 material ("Arms"), 1 mesh, 1 primitive
  UV set      TEXCOORD_0 (the only one)
  IMPORTANT   the UV layout is shared by BOTH hands/forearms. Do not invent or
              redraw UVs: paint onto the existing sheet.

WHAT THE SHEET CONTAINS
  exposed skin/forearm/hand pixels   ~73.5% of the sheet
  glove-region pixels (dark, desat)  ~25.9% of the sheet

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
  512-1024 px maximum dimension. The shipped sheet is 512x512 and is
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
