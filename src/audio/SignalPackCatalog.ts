/**
 * SignalPackCatalog: Curated built-in soundtrack catalog for PLAYHEAD.
 * Maps the 14 soundtrack files from public/music/signal-pack/ into structured,
 * cleaned catalog entries with automated title cleanup.
 */

import { cleanTrackTitle } from './CleanTitle';

export interface SignalPackTrack {
  id: string;
  rawFilename: string;
  title: string;
  artist: string;
  genre: string;
  bpm: number;
  duration: number;
  difficulty: number;
  difficultyLabel: string;
  description: string;
  accentColor: string;
  paletteKey: 'ICE' | 'EMBER' | 'SIGNAL_RED' | 'ACID' | 'ULTRAVIOLET' | 'GLACIER';
  tags: string[];
  audioUrl: string;
}

const RAW_TRACK_DEFINITIONS = [
  {
    raw: 'shiva - Signal Drift - Treblo.mp3',
    genre: 'AMBIENT BASS // DEEP',
    bpm: 105,
    duration: 110,
    difficulty: 1,
    difficultyLabel: 'FLOW',
    desc: 'Wide, open platforms surrounded by quiet celestial landmarks. Ideal introductory track for practicing movement basics.',
    color: '#39ff14',
    palette: 'ACID' as const,
    tags: ['AMBIENT', 'DEEP', 'TRAINING']
  },
  {
    raw: 'shiva - Flow State - Treblo.ogg',
    genre: 'CHILLWAVE // FLOW',
    bpm: 110,
    duration: 72,
    difficulty: 1,
    difficultyLabel: 'FLOW',
    desc: 'Introductory rhythm run with gentle momentum hops, broad landing pads, and relaxing surf curves.',
    color: '#00ff88',
    palette: 'ACID' as const,
    tags: ['FLOW', 'EASY', 'INTRO']
  },
  {
    raw: 'shiva - Surf the Void - Treblo.ogg',
    genre: 'DREAM SURF // ETHEREAL',
    bpm: 120,
    duration: 84,
    difficulty: 2,
    difficultyLabel: 'MOMENTUM',
    desc: 'Extended surf ramps over deep cosmic abysses. Fluid banking and rhythm-locked speed glides.',
    color: '#00bfff',
    palette: 'ICE' as const,
    tags: ['SURF', 'MOMENTUM', 'VOIDS']
  },
  {
    raw: 'shiva - Airwave Theory - Treblo.ogg',
    genre: 'ATMOSPHERIC // SURF',
    bpm: 124,
    duration: 78,
    difficulty: 2,
    difficultyLabel: 'MOMENTUM',
    desc: 'Balanced air-strafe sequences connecting tiered platforms with panoramic skyline views.',
    color: '#00f3ff',
    palette: 'GLACIER' as const,
    tags: ['AIR-STRAFE', 'SPEED']
  },
  {
    raw: 'shiva - Gravity Line - Treblo.ogg',
    genre: 'SYNTHWAVE // GLIDE',
    bpm: 128,
    duration: 90,
    difficulty: 2,
    difficultyLabel: 'MOMENTUM',
    desc: 'Kinetic synth pulses driving sequential bunny-hop jumps through brutalist arch monuments.',
    color: '#7000ff',
    palette: 'ULTRAVIOLET' as const,
    tags: ['BHOP', 'SYNTH', 'MONUMENTS']
  },
  {
    raw: 'Over the Edge.ogg',
    genre: 'HARDWAVE // DRIFT',
    bpm: 135,
    duration: 86,
    difficulty: 3,
    difficultyLabel: 'KINETIC',
    desc: 'Aggressive drops and high-velocity launch pads demanding clean air-strafe corrections.',
    color: '#ff7700',
    palette: 'EMBER' as const,
    tags: ['SPEED', 'DROPS', 'DRIFT']
  },
  {
    raw: 'shiva - Drop Zone Surfer - Treblo.ogg',
    genre: 'BREAKBEAT // KINETIC',
    bpm: 132,
    duration: 94,
    difficulty: 3,
    difficultyLabel: 'KINETIC',
    desc: 'Dynamic breakbeats alternating between technical surf inclines and fast jump chaining.',
    color: '#ff0055',
    palette: 'SIGNAL_RED' as const,
    tags: ['SURF', 'BREAKBEAT']
  },
  {
    raw: 'shiva - Wave Surfing - Treblo.ogg',
    genre: 'PROGRESSIVE // GLIDE',
    bpm: 128,
    duration: 88,
    difficulty: 3,
    difficultyLabel: 'MOMENTUM',
    desc: 'Harmonic progressive lines with continuous surf ramps and rhythm-synced checkpoint gates.',
    color: '#ff00aa',
    palette: 'ULTRAVIOLET' as const,
    tags: ['SURF', 'PROGRESSIVE']
  },
  {
    raw: 'shiva - Neon Abyss - Treblo.mp3',
    genre: 'DARK ELECTRO // VOID',
    bpm: 130,
    duration: 102,
    difficulty: 3,
    difficultyLabel: 'KINETIC',
    desc: 'Heavy basslines and dark monumental framing across an expansive void landscape.',
    color: '#bf00ff',
    palette: 'ULTRAVIOLET' as const,
    tags: ['DARK', 'BASS', 'VOID']
  },
  {
    raw: 'shiva - Neon Slipstream - Treblo.ogg',
    genre: 'HYPERPOP // SPEED',
    bpm: 160,
    duration: 68,
    difficulty: 4,
    difficultyLabel: 'PRECISION',
    desc: 'High-tempo speedway with rapid-fire hop nodes and steep descent ramps.',
    color: '#00ffcc',
    palette: 'ICE' as const,
    tags: ['SPEED', 'HIGH-BPM']
  },
  {
    raw: 'shiva - Ex Gravity - Treblo.ogg',
    genre: 'NEUROFUNK // PRECISION',
    bpm: 174,
    duration: 80,
    difficulty: 4,
    difficultyLabel: 'PRECISION',
    desc: 'Fast 174 BPM neurofunk rhythms demanding tight air-strafe angles and exact jump timing.',
    color: '#ffaa00',
    palette: 'EMBER' as const,
    tags: ['NEURO', '174BPM', 'PRECISION']
  },
  {
    raw: 'shiva - Shadows Over the Circuit - Treblo.mp3',
    genre: 'CYBERPUNK // TECHNICAL',
    bpm: 145,
    duration: 98,
    difficulty: 4,
    difficultyLabel: 'EXPERT',
    desc: 'Complex multi-tier route with offset gaps, blind surf entries, and tight landing windows.',
    color: '#00e5ff',
    palette: 'GLACIER' as const,
    tags: ['TECHNICAL', 'CIRCUITS']
  },
  {
    raw: 'shiva - Waveform Descent - Treblo.ogg',
    genre: 'HALFTIME // DESCENT',
    bpm: 85,
    duration: 92,
    difficulty: 4,
    difficultyLabel: 'PRECISION',
    desc: 'Steep downward elevation steps paired with heavy halftime half-speed bass grooves.',
    color: '#9d00ff',
    palette: 'ULTRAVIOLET' as const,
    tags: ['DESCENT', 'HALFTIME']
  },
  {
    raw: 'shiva - Kz Ascent - Treblo.ogg',
    genre: 'INDUSTRIAL // TECHNICAL',
    bpm: 140,
    duration: 85,
    difficulty: 5,
    difficultyLabel: 'EXPERT',
    desc: 'Peak difficulty vertical ascent route with maximum gap distances and precision surf-to-bhop transitions.',
    color: '#ff3333',
    palette: 'SIGNAL_RED' as const,
    tags: ['KZ', 'CLIMB', 'MAX-DIFFICULTY']
  }
];

export class SignalPackCatalog {
  private static tracks: SignalPackTrack[] = [];

  public static getTracks(): SignalPackTrack[] {
    if (this.tracks.length === 0) {
      this.tracks = RAW_TRACK_DEFINITIONS.map((def, idx) => {
        const cleanTitle = cleanTrackTitle(def.raw);
        const id = `track_${idx + 1}_${cleanTitle.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
        return {
          id,
          rawFilename: def.raw,
          title: cleanTitle,
          artist: 'SIGNAL ARCHIVES',
          genre: def.genre,
          bpm: def.bpm,
          duration: def.duration,
          difficulty: def.difficulty,
          difficultyLabel: def.difficultyLabel,
          description: def.desc,
          accentColor: def.color,
          paletteKey: def.palette,
          tags: def.tags,
          audioUrl: `/music/signal-pack/${encodeURIComponent(def.raw)}`
        };
      });
    }
    return this.tracks;
  }

  public static getTrackById(id: string): SignalPackTrack | undefined {
    return this.getTracks().find(t => t.id === id);
  }
}
