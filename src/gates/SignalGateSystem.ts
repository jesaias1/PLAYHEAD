/**
 * SIGNAL GATE SYSTEM — orchestration for one gate sequence.
 *
 * Gameplay detection (SignalGateSequence) is kept separate from presentation
 * (SignalGateRenderer + sinks). The system reads player state and never writes
 * it: crossing a gate cannot change velocity, acceleration, surf state, the
 * run timer, ranks or rewards.
 */

import * as THREE from 'three';
import { PlayerController } from '../player/PlayerController';
import {
  GateCrossingResult,
  SignalGateDefinition,
  SignalGateSequence
} from './SignalGate';
import { GateMusicState, SignalGateRenderer } from './SignalGateRenderer';

export interface SignalGateSinks {
  /** A gate was successfully passed. */
  crossing(gateIndex: number, total: number, result: GateCrossingResult): void;
  /** Every gate in the chain was passed in order. */
  complete(total: number): void;
}

export class SignalGateSystem {
  public readonly id: string;
  public readonly sequence: SignalGateSequence;
  public sinks: SignalGateSinks | null = null;

  private renderer: SignalGateRenderer;
  private hasPrev = false;
  private prevX = 0;
  private prevY = 0;
  private prevZ = 0;
  private reduceMotion = false;

  constructor(
    id: string,
    definitions: SignalGateDefinition[],
    palette: { primary: THREE.Color; secondary: THREE.Color }
  ) {
    this.id = id;
    this.sequence = new SignalGateSequence(definitions);
    this.renderer = new SignalGateRenderer(this.sequence.gates, palette);

    this.sequence.onCrossing = (gateIndex, total, result) => {
      this.renderer.pulseRipple(this.sequence.gates[gateIndex], this.reduceMotion);
      this.sinks?.crossing(gateIndex, total, result);
    };
    this.sequence.onComplete = (total) => {
      this.sinks?.complete(total);
    };
  }

  public get group(): THREE.Group {
    return this.renderer.group;
  }

  /** Clears all chain state. Call on restart / checkpoint / new run. */
  public reset(): void {
    this.sequence.reset();
    this.hasPrev = false;
  }

  public setDebugVisible(visible: boolean): void {
    this.renderer.setDebugVisible(visible);
  }

  public update(
    dt: number,
    player: PlayerController,
    visualState: GateMusicState,
    reduceMotion: boolean
  ): void {
    this.reduceMotion = reduceMotion;

    const height = player.config.playerHeight;
    const curX = player.position.x;
    const curY = player.position.y + height * 0.5;
    const curZ = player.position.z;

    if (this.hasPrev) {
      this.sequence.update({
        prevX: this.prevX,
        prevY: this.prevY,
        prevZ: this.prevZ,
        curX,
        curY,
        curZ,
        speedUnits: player.getSpeedUnits()
      });
    }

    this.prevX = curX;
    this.prevY = curY;
    this.prevZ = curZ;
    this.hasPrev = true;

    this.renderer.update(this.sequence.gates, dt, visualState, reduceMotion);
  }

  public dispose(): void {
    this.renderer.dispose();
  }
}
