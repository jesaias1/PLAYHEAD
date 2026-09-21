import { describe, expect, it } from 'vitest';
import { TrackAnalysis } from '../src/audio/AudioFeatures';
import { RouteGenerator } from '../src/generation/RouteGenerator';
import { AscentVariant, RouteNode, RouteNodeType } from '../src/generation/GenerationTypes';
import { deriveAscentLandingEnvelope } from '../src/generation/AscentFlowGeometry';
import { getNodeEntryAnchor, getNodeExitAnchor } from '../src/generation/RouteConnectivityValidator';
import { PLAYHEAD_MOVEMENT_V1 } from '../src/player/MovementConfig';

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
  it('is deterministic, finite, and uses moderate flared landing geometry', () => {
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
        expect(node.dimensions.x).toBeGreaterThanOrEqual(13);
        expect(node.dimensions.x).toBeLessThanOrEqual(19);
        expect(node.dimensions.z).toBeGreaterThanOrEqual(23);
        expect(node.dimensions.z).toBeLessThanOrEqual(36);
        expect(node.exitWidth!).toBeGreaterThan(node.dimensions.x);
        expect(Math.abs(node.exitLateralOffset!)).toBeGreaterThan(1);
        expect(node.ascentExpectedSpeed).toBeGreaterThanOrEqual(22);
        expect(node.ascentPostLandingRunway!).toBeGreaterThan(node.ascentExpectedSpeed! * 0.5);
      }

      const catchStep = phrase.at(-1)!;
      expect(catchStep.dimensions.x).toBeGreaterThanOrEqual(16);
      expect(catchStep.dimensions.x).toBeLessThanOrEqual(19);
      expect(catchStep.dimensions.z).toBeGreaterThanOrEqual(30);
      expect(catchStep.dimensions.z).toBeLessThanOrEqual(36);
    }
  });

  it('describes gentle lateral curves instead of centred linear stairs', () => {
    const phrases = ascentPhrases(RouteGenerator.generate(analysisFor(0x12345678)).route);
    expect(phrases.length).toBeGreaterThan(0);

    for (const phrase of phrases) {
      const yawDeltas = phrase.slice(1).map((node, index) => node.yaw - phrase[index].yaw);
      expect(yawDeltas.some(delta => Math.abs(delta) >= 0.025)).toBe(true);
      expect(yawDeltas.every(delta => Math.abs(delta) <= 0.22)).toBe(true);
      const signs = yawDeltas.filter(delta => Math.abs(delta) > 0.001).map(Math.sign);
      expect(new Set(signs).size).toBe(1);
      const wingSigns = phrase.map(node => Math.sign(node.exitLateralOffset!));
      expect(new Set(wingSigns).size).toBe(1);

      for (let i = 1; i < phrase.length; i++) {
        const rise = phrase[i].position.y - phrase[i - 1].position.y;
        expect(rise).toBeGreaterThanOrEqual(0.2);
        expect(rise).toBeLessThanOrEqual(0.5);

        const exit = getNodeExitAnchor(phrase[i - 1]).position;
        const entry = getNodeEntryAnchor(phrase[i]).position;
        const dx = entry.x - exit.x;
        const dz = entry.z - exit.z;
        const gap = Math.hypot(dx, dz);
        expect(gap).toBeGreaterThanOrEqual(phrase[i].ascentMinimumApproach! - 0.01);

        // Frozen jump arc must clear the next top before the leading face.
        const flightTime = gap / phrase[i].ascentExpectedSpeed!;
        const jumpHeight = PLAYHEAD_MOVEMENT_V1.jumpVelocity * flightTime -
          0.5 * PLAYHEAD_MOVEMENT_V1.gravity * flightTime * flightTime;
        expect(jumpHeight).toBeGreaterThan(rise + PLAYHEAD_MOVEMENT_V1.playerRadius * 0.45);

        const approachYaw = Math.atan2(dx, dz);
        const tangentYaw = phrase[i - 1].yaw + (phrase[i].yaw - phrase[i - 1].yaw) * 0.55;
        expect(Math.abs(Math.atan2(Math.sin(approachYaw - tangentYaw), Math.cos(approachYaw - tangentYaw))))
          .toBeLessThan(0.02);
      }

      const entry = getNodeEntryAnchor(phrase[0]).position;
      const exit = getNodeExitAnchor(phrase.at(-1)!).position;
      const dx = exit.x - entry.x;
      const dz = exit.z - entry.z;
      const localLateral = dx * Math.cos(phrase[0].yaw) - dz * Math.sin(phrase[0].yaw);
      expect(Math.abs(localLateral)).toBeGreaterThan(8);
    }
  });

  it('scales landing depth, outside wing, and approach clearance for high-speed arrivals', () => {
    const low = deriveAscentLandingEnvelope(20, 20, 0.35, false, 'FLOW_STAIR', 1);
    const high = deriveAscentLandingEnvelope(30, 20, 0.35, false, 'FLOW_STAIR', 1);
    const catchZone = deriveAscentLandingEnvelope(30, 20, 0.35, true, 'BREATHER_ASCENT', 1);

    expect(high.depth).toBeGreaterThan(low.depth);
    expect(high.width).toBeGreaterThan(low.width);
    expect(high.minimumApproach).toBeGreaterThan(low.minimumApproach);
    expect(high.exitLateralOffset).toBeGreaterThan(low.exitLateralOffset);
    expect(catchZone.depth).toBeGreaterThan(high.depth + 5);
    expect(catchZone.postLandingRunway).toBeGreaterThan(high.postLandingRunway);
  });

  it('selects a controlled vocabulary of ascent variants across seeds', () => {
    const seen = new Set<AscentVariant>();
    const directions = new Set<number>();
    for (let seed = 1; seed <= 16; seed++) {
      for (const phrase of ascentPhrases(RouteGenerator.generate(analysisFor(seed)).route)) {
        seen.add(phrase[0].ascentVariant!);
        directions.add(Math.sign(phrase[0].exitLateralOffset!));
      }
    }
    expect(seen).toEqual(new Set<AscentVariant>([
      'FLOW_STAIR',
      'FLARED_ASCENT',
      'BREATHER_ASCENT',
      'OFFSET_ASCENT'
    ]));
    expect(directions).toEqual(new Set([-1, 1]));
  });
});
