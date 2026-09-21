import { describe, expect, it } from 'vitest';
import { TrackAnalysis } from '../src/audio/AudioFeatures';
import { RouteGenerator } from '../src/generation/RouteGenerator';
import { AscentVariant, RouteNode, RouteNodeType } from '../src/generation/GenerationTypes';

function analysisFor(seed: number): TrackAnalysis {
  return {
    filename: `ascent-flow-${seed}`,
    duration: 70,
    bpm: 132,
    bpmConfidence: 0.95,
    globalEnergy: 0.82,
    frames: [],
    onsets: [],
    sections: [
      { index: 0, start: 0, end: 28, duration: 28, intensity: 0.78, rhythmicDensity: 0.7, brightness: 0.6, theme: 'BUILDUP' },
      { index: 1, start: 28, end: 70, duration: 42, intensity: 0.9, rhythmicDensity: 0.85, brightness: 0.72, theme: 'ASCENT' }
    ],
    waveform: new Float32Array(512),
    seed,
    visualAccent: { name: 'Icy Cyan', hex: '#00f0ff', rgb: [0, 240, 255] }
  };
}

function ascentPhrases(nodes: RouteNode[]): RouteNode[][] {
  const grouped = new Map<number, RouteNode[]>();
  for (const node of nodes) {
    if (node.type !== RouteNodeType.STEP_UP || node.ascentPhraseId === undefined) continue;
    const phrase = grouped.get(node.ascentPhraseId) ?? [];
    phrase.push(node);
    grouped.set(node.ascentPhraseId, phrase);
  }
  return [...grouped.values()].map(phrase => phrase.sort((a, b) => a.ascentStepIndex! - b.ascentStepIndex!));
}

describe('flow ascent generation', () => {
  it('is deterministic, finite, and uses broad flared landing geometry', () => {
    const first = RouteGenerator.generate(analysisFor(0x504c4159));
    const second = RouteGenerator.generate(analysisFor(0x504c4159));
    expect(second.route).toEqual(first.route);

    const phrases = ascentPhrases(first.route);
    expect(phrases.length).toBeGreaterThan(0);
    for (const phrase of phrases) {
      expect(phrase.length).toBeGreaterThanOrEqual(3);
      for (const node of phrase) {
        expect(Number.isFinite(node.position.x)).toBe(true);
        expect(Number.isFinite(node.position.y)).toBe(true);
        expect(Number.isFinite(node.position.z)).toBe(true);
        expect(node.dimensions.x).toBeGreaterThanOrEqual(14);
        expect(node.dimensions.z).toBeGreaterThanOrEqual(18);
        expect(node.exitWidth!).toBeGreaterThan(node.dimensions.x);
      }

      const catchStep = phrase.at(-1)!;
      expect(catchStep.dimensions.x).toBeGreaterThanOrEqual(16.5);
      expect(catchStep.dimensions.z).toBeGreaterThanOrEqual(22);
    }
  });

  it('describes gentle lateral curves instead of centred linear stairs', () => {
    const phrases = ascentPhrases(RouteGenerator.generate(analysisFor(0x12345678)).route);
    expect(phrases.length).toBeGreaterThan(0);

    for (const phrase of phrases) {
      const yawDeltas = phrase.slice(1).map((node, index) => node.yaw - phrase[index].yaw);
      expect(yawDeltas.some(delta => Math.abs(delta) >= 0.025)).toBe(true);
      expect(yawDeltas.every(delta => Math.abs(delta) <= 0.11)).toBe(true);
      const signs = yawDeltas.filter(delta => Math.abs(delta) > 0.001).map(Math.sign);
      expect(new Set(signs).size).toBe(1);

      for (let i = 1; i < phrase.length; i++) {
        const rise = phrase[i].position.y - phrase[i - 1].position.y;
        expect(rise).toBeGreaterThanOrEqual(0.3);
        expect(rise).toBeLessThanOrEqual(0.65);
      }
    }
  });

  it('selects a controlled vocabulary of ascent variants across seeds', () => {
    const seen = new Set<AscentVariant>();
    for (let seed = 1; seed <= 16; seed++) {
      for (const phrase of ascentPhrases(RouteGenerator.generate(analysisFor(seed)).route)) {
        seen.add(phrase[0].ascentVariant!);
      }
    }
    expect(seen).toEqual(new Set<AscentVariant>([
      'FLOW_STAIR',
      'FLARED_ASCENT',
      'BREATHER_ASCENT',
      'OFFSET_ASCENT'
    ]));
  });
});
