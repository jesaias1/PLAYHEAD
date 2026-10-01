/**
 * DEV WORLD PREVIEW — isolated browser fixture for the official world pass.
 *
 * Renders the REAL Environment + World for an official Signal Pack track using
 * the SAME trusted-id load path the game uses, WITHOUT touching account, run,
 * leaderboard, replay or progress state. It never plays audio and never starts
 * a run; it only builds the world and draws presentation frames so a human (or
 * the CUA browser driver) can inspect real rendered variety.
 *
 * Usage (dev server):
 *   npm run dev
 *   open  http://localhost:3000/dev/world-preview.html?track=track_3_surf_the_void
 *
 *   - ?track=<id>   render one official track (default: track_1_signal_drift)
 *   - ?track=ALL    sequentially build every official track and report per-track
 *                   rows (errors, draw calls, objects, FINAL UNSAFE, override)
 *                   in the on-page HUD and on window.__WORLD_SWEEP__.
 *   - ?baseline=1   load each track with a NULL official id (fallback profile)
 *                   using the identical camera + music + scrub, for comparison.
 *   - ?t=<fraction 0..1>  scrub position within the track (default 0.35 = mid).
 *
 * IMPORTANT: ONE World instance is reused across every load. World.loadTrack()
 * disposes the previous track's assets first, so the scene never accumulates
 * worlds, and every reported draw count is the real scene state for that track.
 */

import * as THREE from 'three';
import { Environment } from '../../src/world/Environment';
import { World } from '../../src/world/World';
import { PresetLevelCache } from '../../src/audio/PresetLevelCache';
import { SignalPackCatalog } from '../../src/audio/SignalPackCatalog';

interface SweepEntry {
  trackId: string;
  error: string | null;
  renderCalls: number;
  objects: number;
  geometricObjects: number;
  heroInstances: number;
  finalUnsafe: number | null;
  worldProfileUsesOverride: boolean | null;
}

const root = document.getElementById('preview')!;
const hud = document.getElementById('hud')!;
root.style.position = 'absolute';
root.style.inset = '0';
hud.style.cssText =
  'position:absolute;left:12px;top:12px;z-index:10;color:#9ef;font:12px monospace;' +
  'white-space:pre;text-shadow:0 0 6px #000;pointer-events:none;';

const params = new URLSearchParams(location.search);
const trackParam = params.get('track') || 'track_1_signal_drift';
const baselineMode = params.get('baseline') === '1';
let scrub = Math.max(0, Math.min(1, parseFloat(params.get('t') || '0.35')));

function countRenderables(scene: THREE.Scene): { objects: number; geometricObjects: number } {
  let objects = 0;
  let geometricObjects = 0;
  scene.traverse((o) => {
    objects++;
    const m = o as THREE.Mesh;
    if (m.isMesh || (o as THREE.InstancedMesh).isInstancedMesh) geometricObjects++;
  });
  return { objects, geometricObjects };
}

function countHeroInstances(world: World): number {
  let n = 0;
  world.heroMotifs?.group.traverse((o) => {
    const im = o as THREE.InstancedMesh;
    if (im.isInstancedMesh) n += im.count;
  });
  return n;
}

function placeCamera(environment: Environment, world: World, t: number): void {
  const route = world.track?.route;
  if (!route || route.length === 0) return;
  const idx = Math.max(0, Math.min(route.length - 1, Math.floor(route.length * t)));
  const node = route[idx];
  const prev = route[Math.max(0, idx - 1)];
  const next = route[Math.min(route.length - 1, idx + 1)];
  const dir = new THREE.Vector3(
    next.position.x - prev.position.x,
    next.position.y - prev.position.y,
    next.position.z - prev.position.z
  );
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
  dir.normalize();
  environment.camera.position.set(
    node.position.x - dir.x * 12,
    node.position.y + 6,
    node.position.z - dir.z * 12
  );
  environment.camera.lookAt(
    node.position.x + dir.x * 60,
    node.position.y + 2,
    node.position.z + dir.z * 60
  );
}

/**
 * Load one track into the SHARED world, place the camera, advance a few real
 * frames (update + render the actual scene), then measure draw calls/objects.
 */
async function loadAndMeasure(
  environment: Environment,
  world: World,
  trackId: string
): Promise<SweepEntry> {
  const entry: SweepEntry = {
    trackId,
    error: null,
    renderCalls: 0,
    objects: 0,
    geometricObjects: 0,
    heroInstances: 0,
    finalUnsafe: null,
    worldProfileUsesOverride: null
  };
  try {
    const precomputed = await PresetLevelCache.loadPreset(trackId);
    if (!precomputed) throw new Error(`preset missing for ${trackId}`);
    // TRUSTED id: confirmed against the catalog (never a raw filename).
    // Baseline mode deliberately passes null, exercising the fallback profile
    // with the IDENTICAL camera/music/scrub for a like-for-like comparison.
    const trustedId = baselineMode ? null : SignalPackCatalog.getTrackById(trackId)?.id ?? null;
    world.loadTrack(precomputed.analysis, precomputed.track, environment, trustedId);
    entry.worldProfileUsesOverride = world.worldProfile.usesOverride;
    entry.finalUnsafe = world.worldSafetyReport?.finalUnsafe ?? null;

    placeCamera(environment, world, scrub);
    let songTime = (world.analysis?.duration ?? 100) * scrub;
    for (let f = 0; f < 4; f++) {
      songTime += 1 / 60;
      const progress = Math.min(1, songTime / Math.max(1, world.analysis?.duration ?? 100));
      placeCamera(environment, world, scrub + progress * 0.01);
      world.update(songTime, environment.camera.position, 0, 1 / 60, environment);
      environment.update(1 / 60);
      environment.renderer.info.reset();
      environment.render();
    }
    entry.renderCalls = environment.renderer.info.render.calls;
    entry.heroInstances = countHeroInstances(world);
  } catch (err) {
    entry.error = err instanceof Error ? err.message : String(err);
  }
  const c = countRenderables(environment.scene);
  entry.objects = c.objects;
  entry.geometricObjects = c.geometricObjects;
  return entry;
}

function entryLine(r: SweepEntry): string {
  return (
    `${r.trackId.padEnd(34)} unsafe=${r.finalUnsafe} calls=${r.renderCalls} ` +
    `objs=${r.objects} heroInst=${r.heroInstances} override=${r.worldProfileUsesOverride} ` +
    `err=${r.error ?? '-'}`
  );
}

async function renderSingle(
  environment: Environment,
  world: World,
  trackId: string
): Promise<void> {
  const report = await loadAndMeasure(environment, world, trackId);
  hud.textContent =
    `TRACK  ${trackId}${baselineMode ? '  (BASELINE fallback)' : ''}\n` +
    `PROFILE override=${report.worldProfileUsesOverride}\n` +
    `FINAL UNSAFE  ${report.finalUnsafe}\n` +
    `DRAW CALLS  ${report.renderCalls}\n` +
    `OBJECTS  ${report.objects}  (renderables ${report.geometricObjects})\n` +
    `HERO INSTANCES  ${report.heroInstances}\n` +
    `ERROR  ${report.error ?? 'none'}\n` +
    `DONE`;
  (window as unknown as Record<string, unknown>).__WORLD_REPORT__ = report;
}

async function renderAll(environment: Environment, world: World): Promise<void> {
  const results: SweepEntry[] = [];
  // Header row in the DOM (not only window globals).
  const header =
    'TRACK'.padEnd(34) +
    ' unsafe calls objs heroInst override err';
  const paint = (): void => {
    hud.textContent =
      (baselineMode ? 'MODE  BASELINE (null official id)\n' : 'MODE  OFFICIAL\n') +
      header + '\n' +
      results.map(entryLine).join('\n') +
      `\nrows=${results.length}`;
  };
  paint();
  for (const track of SignalPackCatalog.getTracks()) {
    const report = await loadAndMeasure(environment, world, track.id);
    results.push(report);
    paint();
  }
  const errors = results.filter((r) => r.error !== null).length;
  hud.textContent += `\nerrors=${errors} finalUnsafe=[${results.map((r) => r.finalUnsafe).join(',')}]\nDONE`;
  (window as unknown as Record<string, unknown>).__WORLD_SWEEP__ = results;
  console.log('[WORLD SWEEP]', JSON.stringify(results, null, 2));
}

/** Cheap track selector + scrub reload controls (single-track mode). */
function installControls(environment: Environment, world: World): void {
  if (trackParam.toUpperCase() === 'ALL') return;
  const bar = document.createElement('div');
  bar.style.cssText =
    'position:absolute;right:12px;top:12px;z-index:11;font:12px monospace;color:#9ef;' +
    'background:#0008;padding:6px;border-radius:4px;';
  const select = document.createElement('select');
  for (const t of SignalPackCatalog.getTracks()) {
    const o = document.createElement('option');
    o.value = t.id;
    o.textContent = t.id;
    if (t.id === trackParam) o.selected = true;
    select.appendChild(o);
  }
  select.onchange = (): void => {
    const u = new URL(location.href);
    u.searchParams.set('track', select.value);
    u.searchParams.delete('baseline');
    location.href = u.toString();
  };
  const range = document.createElement('input');
  range.type = 'range';
  range.min = '0';
  range.max = '1';
  range.step = '0.05';
  range.value = String(scrub);
  range.onchange = (): void => {
    scrub = Number(range.value);
    void loadAndMeasure(environment, world, trackParam).then((r) => {
      hud.textContent += `\nscrub t=${range.value}\ncalls=${r.renderCalls} objs=${r.objects}`;
    });
  };
  bar.appendChild(document.createTextNode('TRACK '));
  bar.appendChild(select);
  bar.appendChild(document.createTextNode('  T '));
  bar.appendChild(range);
  root.parentElement?.appendChild(bar);
}

async function main(): Promise<void> {
  const environment = new Environment(root);
  // ONE world, reused for every load: loadTrack disposes the previous assets.
  const world = new World(environment.scene);
  installControls(environment, world);
  if (trackParam.toUpperCase() === 'ALL') {
    await renderAll(environment, world);
  } else {
    await renderSingle(environment, world, trackParam);
  }
}

void main();
