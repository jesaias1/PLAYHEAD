/**
 * Main application entry point for PLAYHEAD
 */

import './styles/main.css';
import { Game } from './core/Game';
import { raceRoomService } from './online/RaceRoomService';
import { authService } from './online/AuthService';
import { cloudProgression } from './online/CloudProgression';

import { PresetGenerator } from './audio/PresetGenerator';

function init() {
  const canvasContainer = document.getElementById('canvas-container');
  const uiRoot = document.getElementById('ui-root');

  if (!canvasContainer || !uiRoot) {
    console.error('Fatal: Missing root DOM mount elements');
    return;
  }

  // Instantiate PLAYHEAD
  const game = new Game(canvasContainer, uiRoot);
  (window as unknown as { game: Game; PresetGenerator: typeof PresetGenerator }).game = game;
  (window as unknown as { game: Game; PresetGenerator: typeof PresetGenerator }).PresetGenerator = PresetGenerator;
  // Automation hook: lets a two-browser integrity harness drive rooms and
  // accounts deterministically. No gameplay behaviour depends on it; it only
  // re-exports singletons that already exist in the bundle.
  (window as unknown as { __playheadHarness: unknown }).__playheadHarness = {
    game,
    raceRoomService,
    authService,
    cloudProgression
  };
  console.log('[PLAYHEAD] System online. Enter the signal.');
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

