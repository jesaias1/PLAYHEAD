/**
 * Central UI Manager coordinating DOM screens with Game StateMachine
 */

import { ImportScreen } from './ImportScreen';
import { AnalysisScreen } from './AnalysisScreen';
import { CountdownScreen } from './CountdownScreen';
import { Hud } from './Hud';
import { PauseScreen } from './PauseScreen';
import { ResultsScreen } from './ResultsScreen';
import { SettingsModal } from './SettingsModal';
import { VisualAccent } from '../audio/AudioFeatures';

export class UIManager {
  public importScreen: ImportScreen;
  public analysisScreen: AnalysisScreen;
  public countdownScreen: CountdownScreen;
  public hud: Hud;
  public pauseScreen: PauseScreen;
  public resultsScreen: ResultsScreen;
  public settingsModal: SettingsModal;

  public root: HTMLElement;

  constructor(rootElement: HTMLElement) {
    this.root = rootElement;

    this.importScreen = new ImportScreen();
    this.analysisScreen = new AnalysisScreen();
    this.countdownScreen = new CountdownScreen();
    this.hud = new Hud();
    this.pauseScreen = new PauseScreen();
    this.resultsScreen = new ResultsScreen();
    this.settingsModal = new SettingsModal();

    this.root.appendChild(this.importScreen.element);
    this.root.appendChild(this.analysisScreen.element);
    this.root.appendChild(this.countdownScreen.element);
    this.root.appendChild(this.hud.element);
    this.root.appendChild(this.pauseScreen.element);
    this.root.appendChild(this.resultsScreen.element);
    this.root.appendChild(this.settingsModal.element);
  }

  public applyAccent(accent: VisualAccent): void {
    document.documentElement.style.setProperty('--accent-color', accent.hex);
    document.documentElement.style.setProperty('--accent-rgb', accent.rgb.join(', '));
    document.documentElement.style.setProperty('--accent-glow', `rgba(${accent.rgb.join(', ')}, 0.3)`);
    document.documentElement.style.setProperty('--accent-dim', `rgba(${accent.rgb.join(', ')}, 0.08)`);
  }

  public hideAllScreens(): void {
    this.importScreen.hide();
    this.analysisScreen.hide();
    this.countdownScreen.cancel();
    this.hud.hide();
    this.pauseScreen.hide();
    this.resultsScreen.hide();
    this.settingsModal.hide();
  }
}
