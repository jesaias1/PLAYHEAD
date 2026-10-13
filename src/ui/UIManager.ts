/**
 * Central UI Manager coordinating DOM screens with Game StateMachine
 */

import { makeDesktopWindow } from './DesktopWindow';
import { ImportScreen } from './ImportScreen';
import { AnalysisScreen } from './AnalysisScreen';
import { CountdownScreen } from './CountdownScreen';
import { Hud } from './Hud';
import { PauseScreen } from './PauseScreen';
import { ResultsScreen } from './ResultsScreen';
import { SettingsModal } from './SettingsModal';
import { ArmoryModal } from './ArmoryModal';
import { MovementLabSongModal } from './MovementLabSongModal';
import { SignalDecodeModal } from './SignalDecodeModal';
import { ProfileModal } from './ProfileModal';
import { LoginModal } from './LoginModal';
import { RaceHud } from './RaceHud';
import { ReplayOverlay } from './ReplayOverlay';
import { VisualAccent } from '../audio/AudioFeatures';

export class UIManager {
  public importScreen: ImportScreen;
  public analysisScreen: AnalysisScreen;
  public countdownScreen: CountdownScreen;
  public hud: Hud;
  public pauseScreen: PauseScreen;
  public resultsScreen: ResultsScreen;
  public settingsModal: SettingsModal;
  public armoryModal: ArmoryModal;
  public movementLabSongModal: MovementLabSongModal;
  public decodeModal: SignalDecodeModal;
  /** Player identity surface. A modal, not a navigation tab. */
  public profileModal: ProfileModal;
  /** Username + password account surface (no email). */
  public loginModal: LoginModal;
  /** Shared best-time session overlay (hidden outside a race). */
  public raceHud: RaceHud;
  /** Minimal first-person replay controls (POV Replay V1). */
  public replayOverlay: ReplayOverlay;

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
    this.armoryModal = new ArmoryModal();
    this.movementLabSongModal = new MovementLabSongModal();
    this.decodeModal = new SignalDecodeModal();
    this.profileModal = new ProfileModal();
    this.loginModal = new LoginModal();
    this.raceHud = new RaceHud();
    this.replayOverlay = new ReplayOverlay();

    this.armoryModal.setDecodeModal(this.decodeModal);
    this.importScreen.setDecodeModal(this.decodeModal);
    this.importScreen.onOpenLegacyReveal = () => this.importScreen.openLegacyReveal();
    this.resultsScreen.setDecodeModal(this.decodeModal);

    this.root.appendChild(this.importScreen.element);
    this.root.appendChild(this.analysisScreen.element);
    this.root.appendChild(this.countdownScreen.element);
    this.root.appendChild(this.hud.element);
    this.root.appendChild(this.pauseScreen.element);
    this.root.appendChild(this.resultsScreen.element);
    this.root.appendChild(this.settingsModal.element);
    this.root.appendChild(this.armoryModal.element);
    this.root.appendChild(this.movementLabSongModal.element);
    this.root.appendChild(this.decodeModal.element);
    this.root.appendChild(this.profileModal.element);
    this.root.appendChild(this.loginModal.element);
    this.root.appendChild(this.raceHud.element);
    this.root.appendChild(this.replayOverlay.element);

    this.importScreen.mountDesktopBackdrop(this.root, this.analysisScreen.element);

    const windows: [HTMLElement, string, string, string?][] = [
      [this.importScreen.element, '.import-container', 'M0VEM1NT — Music Explorer', '.console-topbar'],
      [this.analysisScreen.element, '.analysis-container', 'M0VEM1NT — Preparing track'],
      [this.resultsScreen.element, '.results-container', 'M0VEM1NT — Run report'],
      [this.pauseScreen.element, '.pause-container', 'M0VEM1NT — Paused', '.pause-title'],
      [this.settingsModal.element, '.settings-container', 'M0VEM1NT — Settings', '.pause-title'],
      [this.profileModal.element, '.profile-container', 'M0VEM1NT — Player'],
      [this.loginModal.element, '.profile-container', 'M0VEM1NT — Account'],
      [this.armoryModal.element, '.armory-modal-console', 'M0VEM1NT — Armory'],
      [this.movementLabSongModal.element, '.settings-container', 'M0VEM1NT — Choose music'],
      [this.decodeModal.element, '.decode-modal-dialog', 'M0VEM1NT — Signal decoder'],
    ];
    for (const [screen, selector, title, handleSelector] of windows) {
      const panel = screen.querySelector<HTMLElement>(selector);
      if (panel) makeDesktopWindow(panel, title, handleSelector ? panel.querySelector<HTMLElement>(handleSelector) ?? undefined : undefined);
    }
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
    this.armoryModal.hide();
    this.movementLabSongModal.hide();
    this.decodeModal.hide();
    this.profileModal.hide();
    this.loginModal.hide();
  }
}
