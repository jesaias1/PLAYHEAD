import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PixelArtLibrary } from '../src/world/PixelArtLibrary';
import { CitySignageSystem, MonolithAnchor, StelaAnchor } from '../src/world/CitySignageSystem';
import { TrackAnalysis } from '../src/audio/AudioFeatures';
import { GeneratedTrack, RouteNode, RouteNodeType } from '../src/generation/GenerationTypes';
import { RouteExclusionCorridor } from '../src/world/RouteExclusionCorridor';
import { MusicVisualState } from '../src/world/MusicVisualController';

function createMockAnalysis(): TrackAnalysis {
  return {
    filename: '13_signal_drift.mp3',
    duration: 60,
    bpm: 105,
    bpmConfidence: 0.95,
    globalEnergy: 0.7,
    frames: [],
    onsets: [],
    sections: [
      {
        index: 0,
        start: 0,
        end: 20,
        duration: 20,
        intensity: 0.5,
        rhythmicDensity: 0.5,
        brightness: 0.5,
        theme: 'FLOW'
      },
      {
        index: 1,
        start: 20,
        end: 40,
        duration: 20,
        intensity: 0.9,
        rhythmicDensity: 0.8,
        brightness: 0.8,
        theme: 'DROP'
      }
    ],
    waveform: new Float32Array(512).fill(0.5),
    seed: 12345,
    visualAccent: {
      hex: '#00f0ff',
      rgb: [0, 240, 255],
      name: 'CYAN'
    }
  };
}

function createMockTrack(): GeneratedTrack {
  const route: RouteNode[] = [];
  for (let i = 0; i < 20; i++) {
    route.push({
      id: i,
      time: i * 3,
      position: { x: 0, y: 0, z: i * 20 },
      dimensions: { x: 8, y: 1, z: 12 },
      yaw: 0,
      pitch: 0,
      roll: 0,
      type: i === 7 ? RouteNodeType.CHECKPOINT : RouteNodeType.RUNWAY,
      intensity: 0.5,
      sectionIndex: i < 7 ? 0 : 1,
      arcLength: i * 20,
      isSurf: false,
      isBoost: false
    });
  }

  return {
    seed: 12345,
    route,
    checkpoints: [],
    finish: { routeNodeId: 19, time: 57, position: { x: 0, y: 0, z: 380 }, yaw: 0 },
    totalDistance: 380,
    targetDuration: 60,
    repairedJumpsCount: 0
  };
}

describe('CitySignageSystem & PixelArtLibrary Textures', () => {
  it('generates and caches authored billboard textures from track metadata', () => {
    const analysis = createMockAnalysis();

    const heroTex1 = PixelArtLibrary.getTrackHeroBannerTexture(
      'SIGNAL DRIFT',
      105,
      'SD-05',
      '#00f0ff',
      '#ff00aa',
      analysis.waveform
    );
    const heroTex2 = PixelArtLibrary.getTrackHeroBannerTexture(
      'SIGNAL DRIFT',
      105,
      'SD-05',
      '#00f0ff',
      '#ff00aa',
      analysis.waveform
    );
    expect(heroTex1).toBeDefined();
    expect(heroTex1).toBe(heroTex2); // Caching check

    const jpTex = PixelArtLibrary.getVerticalJapaneseSignTexture(0, '#00f0ff', '#ff00aa');
    expect(jpTex).toBeDefined();

    const telemTex = PixelArtLibrary.getHorizontalTelemetryTexture(
      'SIGNAL DRIFT',
      'DROP',
      '#00f0ff',
      '#ff00aa'
    );
    expect(telemTex).toBeDefined();

    const spectroTex = PixelArtLibrary.getSpectrogramMatrixTexture('#00f0ff', '#ff00aa');
    expect(spectroTex).toBeDefined();

    const crownTex = PixelArtLibrary.getRooftopCrownTexture(0, '#00f0ff', '#ff00aa');
    expect(crownTex).toBeDefined();

    const winTex = PixelArtLibrary.getWindowClusterTexture('cool', '#00f0ff');
    expect(winTex).toBeDefined();

    const ribTex = PixelArtLibrary.getFacadeRibsTexture('#00f0ff');
    expect(ribTex).toBeDefined();
  });

  it('builds signage on monolith and stela anchors and respects RouteExclusionCorridor', () => {
    const analysis = createMockAnalysis();
    const track = createMockTrack();
    const corridor = new RouteExclusionCorridor(track.route);

    const monoliths: MonolithAnchor[] = [
      {
        position: new THREE.Vector3(160, 50, 60),
        width: 24,
        height: 400,
        topY: 100,
        abyssBottom: -300,
        yaw: 0,
        side: 1,
        fwdX: 0,
        fwdZ: 1,
        rightX: 1,
        rightZ: 0,
        node: track.route[3],
        nodeIndex: 3,
        progressRatio: 0.2,
        isHero: true
      },
      {
        position: new THREE.Vector3(-160, 50, 140),
        width: 24,
        height: 400,
        topY: 100,
        abyssBottom: -300,
        yaw: 0,
        side: -1,
        fwdX: 0,
        fwdZ: 1,
        rightX: 1,
        rightZ: 0,
        node: track.route[7],
        nodeIndex: 7,
        progressRatio: 0.4,
        isHero: false
      }
    ];

    const stelae: StelaAnchor[] = [
      {
        position: new THREE.Vector3(135, 30, 80),
        width: 10,
        height: 350,
        topY: 60,
        abyssBottom: -290,
        yaw: 0,
        side: 1,
        fwdX: 0,
        fwdZ: 1,
        rightX: 1,
        rightZ: 0,
        node: track.route[4],
        progressRatio: 0.25
      }
    ];

    const signage = new CitySignageSystem(analysis, track, corridor, monoliths, stelae);
    expect(signage.group.children.length).toBeGreaterThan(0);

    // Verify distance culling
    const camPos = new THREE.Vector3(0, 0, 0);
    signage.applyDistanceCulling(camPos, 100); // 100m cutoff: towers at 160m should be culled
    for (const child of signage.group.children) {
      if (child instanceof THREE.Mesh) {
        expect(child.visible).toBe(false);
      }
    }

    signage.applyDistanceCulling(camPos, 0); // 0 disables culling: should restore all
    for (const child of signage.group.children) {
      if (child instanceof THREE.Mesh) {
        expect(child.visible).toBe(true);
      }
    }

    // Verify update reactivity
    const vState: MusicVisualState = {
      time: 25.0,
      progress: 0.4,
      playerProgress: 0.4,
      syncDelta: 0,
      energy: 0.8,
      subBass: 0.7,
      bass: 0.85,
      lowMid: 0.6,
      mid: 0.7,
      high: 0.75,
      brightness: 0.6,
      flux: 0.5,
      onsetPulse: 0.8,
      sectionIndex: 1,
      sectionTheme: 'DROP',
      sectionIntensity: 0.9,
      sectionProgress: 0.25,
      buildup: 0,
      dropImpact: 0.9,
      upcomingEnergy: 0.8,
      upcomingDropDistance: 999,
      nextDropTime: 999,
      palette: {
        id: 'CYAN',
        name: 'CYAN',
        primary: 0x00f0ff,
        secondary: 0xff00aa,
        accent: 0x00f0ff,
        background: 0x020306,
        surface: 0x080c14,
        text: 0xffffff,
        grid: 0x1e293b,
        glow: 0x00f0ff
      },
      primaryMix: 0.5,
      secondaryMix: 0.2,
      highlightMix: 0.1,
      bassColor: new THREE.Color(1, 0, 0.5),
      midColor: new THREE.Color(0, 1, 1),
      highColor: new THREE.Color(1, 1, 1),
      activeHorizonColor: new THREE.Color(0, 0, 0),
      activeHazeColor: new THREE.Color(0, 0, 0),
      routePulsePhase: 0,
      kineticMusicIntensity: 0.8,
      dramaticIntensity: 0.9,
      reactivityMultiplier: 1.0
    };

    expect(() => signage.update(vState, 0.016)).not.toThrow();

    // Verify clean disposal
    expect(() => signage.dispose()).not.toThrow();
  });
});
