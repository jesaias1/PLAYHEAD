/**
 * Main application entry point for PLAYHEAD
 */

import './styles/main.css';
import { Game } from './core/Game';

window.addEventListener('DOMContentLoaded', () => {
  const canvasContainer = document.getElementById('canvas-container');
  const uiRoot = document.getElementById('ui-root');

  if (!canvasContainer || !uiRoot) {
    console.error('Fatal: Missing root DOM mount elements');
    return;
  }

  // Instantiate PLAYHEAD
  new Game(canvasContainer, uiRoot);
  console.log('[PLAYHEAD] System online. Drop a song to enter it.');
});
