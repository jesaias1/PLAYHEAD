import { describe, it, expect } from 'vitest';
import { cleanTrackTitle } from '../src/audio/CleanTitle';

describe('CleanTitle', () => {
  it('cleans standard pattern "shiva - <title> - Treblo.ogg"', () => {
    expect(cleanTrackTitle('shiva - Airwave Theory - Treblo.ogg')).toBe('AIRWAVE THEORY');
    expect(cleanTrackTitle('shiva - Drop Zone Surfer - Treblo.ogg')).toBe('DROP ZONE SURFER');
    expect(cleanTrackTitle('shiva - Ex Gravity - Treblo.ogg')).toBe('EX GRAVITY');
    expect(cleanTrackTitle('shiva - Flow State - Treblo.ogg')).toBe('FLOW STATE');
    expect(cleanTrackTitle('shiva - Gravity Line - Treblo.ogg')).toBe('GRAVITY LINE');
    expect(cleanTrackTitle('shiva - Kz Ascent - Treblo.ogg')).toBe('KZ ASCENT');
    expect(cleanTrackTitle('shiva - Neon Slipstream - Treblo.ogg')).toBe('NEON SLIPSTREAM');
    expect(cleanTrackTitle('shiva - Surf the Void - Treblo.ogg')).toBe('SURF THE VOID');
    expect(cleanTrackTitle('shiva - Wave Surfing - Treblo.ogg')).toBe('WAVE SURFING');
    expect(cleanTrackTitle('shiva - Waveform Descent - Treblo.ogg')).toBe('WAVEFORM DESCENT');
  });

  it('cleans mp3 files with pattern', () => {
    expect(cleanTrackTitle('shiva - Neon Abyss - Treblo.mp3')).toBe('NEON ABYSS');
    expect(cleanTrackTitle('shiva - Shadows Over the Circuit - Treblo.mp3')).toBe('SHADOWS OVER THE CIRCUIT');
    expect(cleanTrackTitle('shiva - Signal Drift - Treblo.mp3')).toBe('SIGNAL DRIFT');
  });

  it('cleans files without shiva or treblo', () => {
    expect(cleanTrackTitle('Over the Edge.ogg')).toBe('OVER THE EDGE');
  });

  it('handles variations in case and spacing', () => {
    expect(cleanTrackTitle('Shiva Overdrive Treblo.ogg')).toBe('OVERDRIVE');
    expect(cleanTrackTitle('SHIVA - Cyber Track - TREBLO.MP3')).toBe('CYBER TRACK');
  });
});
