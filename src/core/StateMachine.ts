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
    if ((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV) console.log(`[StateMachine] ${prevState} -> ${newState}`);

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
        if (to === GameState.ANALYSING) return true;
        // WATCH: canonical playback preparation (audio + world restored from the
        // baked preset) finishes in READY, so READY must be able to enter REPLAY.
        // FINISHED -> REPLAY stays valid for local results.
        return to === GameState.COUNTDOWN || to === GameState.REPLAY || to === GameState.IMPORT;

      case GameState.COUNTDOWN:
        return to === GameState.PLAYING || to === GameState.IMPORT;

      case GameState.PLAYING:
        return to === GameState.PAUSED || to === GameState.FINISHED || to === GameState.IMPORT || to === GameState.COUNTDOWN;

      case GameState.PAUSED:
        return to === GameState.PLAYING || to === GameState.COUNTDOWN || to === GameState.IMPORT || to === GameState.MOVEMENT_LAB;

      case GameState.FINISHED:
        // RETRY: a fresh attempt on the same track restarts gameplay directly.
        // (The finish pipeline that produced the report does not re-run.)
        return (
          to === GameState.PLAYING ||
          // Results actions load the next canonical signal or a verified PB
          // trajectory directly, without returning through the import screen.
          to === GameState.ANALYSING ||
          to === GameState.REPLAY ||
          to === GameState.COUNTDOWN ||
          to === GameState.IMPORT
        );

      case GameState.REPLAY:
        return to === GameState.FINISHED || to === GameState.COUNTDOWN || to === GameState.IMPORT;

      default:
        return false;
    }
  }
}
