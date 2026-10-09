-- Add white finishes to the existing server-authoritative drop pool.
-- Existing ownership, award and opening rules remain unchanged.
create or replace function public.signal_drop_catalog()
returns jsonb language sql immutable as $$
  select $q$[
    {"id":"ASTRAL","rarity":"RARE"},
    {"id":"VOID_SIGNAL","rarity":"RARE"},
    {"id":"REDSHIFT","rarity":"RELIC"},
    {"id":"PRISM_STATIC","rarity":"RELIC"},
    {"id":"AMBER_SIGNAL","rarity":"STANDARD"},
    {"id":"WHITE_NOISE","rarity":"STANDARD"},
    {"id":"SIGNALISM_ARTIFACT","rarity":"ARTIFACT"},
    {"id":"GOD_RUN_ARTIFACT","rarity":"ARTIFACT"},
    {"id":"PRISM_ARTIFACT","rarity":"ARTIFACT"},
    {"id":"CYBER_ARTIFACT","rarity":"OVERCLOCKED"},
    {"id":"RADIO_ARTIFACT","rarity":"ARTIFACT"},
    {"id":"UNDERWORLD_ARTIFACT","rarity":"ARTIFACT"},
    {"id":"SYNTH_ARTIFACT","rarity":"ARTIFACT"},
    {"id":"DNA_ARTIFACT","rarity":"ARTIFACT"},
    {"id":"MIRRORS_ARTIFACT","rarity":"ARTIFACT"},
    {"id":"PINK_SMOKE_ARTIFACT","rarity":"ARTIFACT"},
    {"id":"BLUE_SMOKE_ARTIFACT","rarity":"ARTIFACT"},
    {"id":"WHITE_SMOKE_ARTIFACT","rarity":"ARTIFACT"},
    {"id":"BLUE_MARBLE_ARTIFACT","rarity":"ARTIFACT"},
    {"id":"ACID_ARTIFACT","rarity":"ARTIFACT"},
    {"id":"RAINBOW_VORTEX_ARTIFACT","rarity":"ARTIFACT"},
    {"id":"BLUE_GEM","rarity":"RARE"},
    {"id":"DROP_GLOVE_PORCELAIN","rarity":"RARE"},
    {"id":"DROP_GLOVE_ARCTIC_WEAVE","rarity":"RELIC"},
    {"id":"DROP_GLOVE_MOONSTONE","rarity":"RELIC"},
    {"id":"DROP_GLOVE_CREME","rarity":"STANDARD"},
    {"id":"DROP_GLOVE_PEARL","rarity":"RARE"},
    {"id":"DROP_GLOVE_PEARL_ICE","rarity":"RELIC"},
    {"id":"DROP_GLOVE_SILVERSKIN","rarity":"RARE"},
    {"id":"DROP_GLOVE_CYBER","rarity":"RARE"},
    {"id":"DROP_GLOVE_CYBER_FULL","rarity":"RELIC"},
    {"id":"DROP_GLOVE_CRYSTAL","rarity":"RELIC"},
    {"id":"DROP_GLOVE_SYNTH","rarity":"RELIC"},
    {"id":"DROP_GLOVE_AUREATE","rarity":"RELIC"},
    {"id":"DROP_GLOVE_SYNTH_FULL","rarity":"ARTIFACT"},
    {"id":"DROP_GLOVE_AUREATE_FULL","rarity":"OVERCLOCKED"}
  ]$q$::jsonb;
$$;
