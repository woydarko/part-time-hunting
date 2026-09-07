/**
 * NpcIdleController - drives a sibling AnimationStateMachineNode to make a standing NPC feel alive.
 *
 * Every few seconds it fires a random one-shot ambient gesture (idle variation, "use item",
 * "pick up") by pulsing the `gesture` parameter, holds it for the clip, then returns to idle.
 * Add it as a child of the same node that carries the AnimationStateMachineNode (e.g. the Rogue
 * shopkeeper model). Requires the animconfig to define states keyed off a `gesture` parameter
 * (0 = idle, 1 = idle_b, 2 = use_item, 3 = pickup).
 */

import * as ENGINE from '@gnsx/genesys.js';

const GESTURE_COUNT = 3; // gesture ids 1..3

@ENGINE.GameClass()
export class NpcIdleController extends ENGINE.SceneNode {
  /** Minimum seconds of plain idle between ambient gestures. */
  @ENGINE.property()
  public minInterval = 5;

  /** Maximum seconds of plain idle between ambient gestures. */
  @ENGINE.property()
  public maxInterval = 11;

  /** Seconds to hold each gesture before blending back to idle. */
  @ENGINE.property()
  public gestureHold = 2.2;

  private asm: ENGINE.AnimationStateMachineNode | null = null;
  private idleTimer = 0;
  private nextAt = 0;
  private holdTimer = 0;
  private activeGesture = 0;

  public override beginPlay(): boolean {
    if (!super.beginPlay()) return false;
    // The AnimationStateMachineNode is a sibling under the same NPC root.
    this.asm =
      this.parent?.getNode(ENGINE.AnimationStateMachineNode) ??
      this.getRoot()?.getNode(ENGINE.AnimationStateMachineNode) ??
      null;
    this.scheduleNext();
    return true;
  }

  /** Force a specific gesture immediately (e.g. an interact greeting), overriding the idle timer. */
  public forceGesture(gestureId: number, hold: number): void {
    if (!this.asm) return;
    this.activeGesture = gestureId;
    this.holdTimer = hold;
    this.asm.setParameter('gesture', gestureId);
  }

  private scheduleNext(): void {
    const span = Math.max(0, this.maxInterval - this.minInterval);
    this.nextAt = this.minInterval + Math.random() * span;
    this.idleTimer = 0;
  }

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);
    if (!this.asm) return;

    if (this.activeGesture !== 0) {
      this.holdTimer -= deltaTime;
      if (this.holdTimer <= 0) {
        this.asm.setParameter('gesture', 0);
        this.activeGesture = 0;
        this.scheduleNext();
      }
      return;
    }

    this.idleTimer += deltaTime;
    if (this.idleTimer >= this.nextAt) {
      this.activeGesture = 1 + Math.floor(Math.random() * GESTURE_COUNT); // 1..3
      this.holdTimer = this.gestureHold;
      this.asm.setParameter('gesture', this.activeGesture);
    }
  }
}
