/**
 * StateMachine for TRACK//RUN game states
 */

export enum GameState {
  BOOT = 'BOOT',
  IMPORT = 'IMPORT',
  ANALYSING = 'ANALYSING',
  READY = 'READY',
  COUNTDOWN = 'COUNTDOWN',
  PLAYING = 'PLAYING',
  PAUSED = 'PAUSED',
  FINISHED = 'FINISHED',
  REPLAY = 'REPLAY',
  MOVEMENT_LAB = 'MOVEMENT_LAB'
}

export type StateListener = (newState: GameState, prevState: GameState) => void;

export class StateMachine {
  private currentState: GameState = GameState.BOOT;
  private listeners: StateListener[] = [];

  constructor(initialState: GameState = GameState.BOOT) {
    this.currentState = initialState;
  }

  public getState(): GameState {
    return this.currentState;
  }

  public is(state: GameState): boolean {
    return this.currentState === state;
  }

  public transitionTo(newState: GameState): boolean {
    if (this.currentState === newState) {
      return false;
    }

    // Validate state transitions
    if (!this.isValidTransition(this.currentState, newState)) {
      console.warn(`[StateMachine] Invalid transition attempt: ${this.currentState} -> ${newState}`);
      return false;
    }

    const prevState = this.currentState;
    this.currentState = newState;
    console.log(`[StateMachine] ${prevState} -> ${newState}`);

    for (const listener of this.listeners) {
      try {
        listener(newState, prevState);
      } catch (err) {
        console.error(`[StateMachine] Listener error on transition to ${newState}:`, err);
      }
    }

    return true;
  }

  public onTransition(listener: StateListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx !== -1) {
        this.listeners.splice(idx, 1);
      }
    };
  }

  private isValidTransition(from: GameState, to: GameState): boolean {
    switch (from) {
      case GameState.BOOT:
        return to === GameState.IMPORT;

      case GameState.IMPORT:
        return to === GameState.ANALYSING || to === GameState.MOVEMENT_LAB;

      case GameState.MOVEMENT_LAB:
        return to === GameState.PAUSED || to === GameState.IMPORT;

      case GameState.ANALYSING:
        return to === GameState.READY || to === GameState.IMPORT;

      case GameState.READY:
        return to === GameState.COUNTDOWN || to === GameState.IMPORT;

      case GameState.COUNTDOWN:
        return to === GameState.PLAYING || to === GameState.IMPORT;

      case GameState.PLAYING:
        return to === GameState.PAUSED || to === GameState.FINISHED || to === GameState.IMPORT || to === GameState.COUNTDOWN;

      case GameState.PAUSED:
        return to === GameState.PLAYING || to === GameState.COUNTDOWN || to === GameState.IMPORT || to === GameState.MOVEMENT_LAB;

      case GameState.FINISHED:
        return to === GameState.REPLAY || to === GameState.COUNTDOWN || to === GameState.IMPORT;

      case GameState.REPLAY:
        return to === GameState.FINISHED || to === GameState.COUNTDOWN || to === GameState.IMPORT;

      default:
        return false;
    }
  }
}
