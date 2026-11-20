/**
 * ArrowProjectile - a ballistic flying arrow. Spawned by ranged weapons with an initial velocity,
 * it falls under gravity (matching the aim trajectory preview) and raycasts each frame from its old
 * position to its new one so it can't tunnel through thin geometry. On the first blocking hit it
 * deals damage (if the hit root exposes `takeDamage`) and despawns; otherwise it despawns after
 * `maxDistance` of travel or `maxLifetime`. The mesh re-orients to the velocity each frame so the
 * arrow tips downward as it arcs.
 *
 * Spawned in code (not authored in a scene). Call `launch()` once after adding it to the world.
 *
 * Co-op: every machine flies its own copy of the arrow (the shooter's pawn multicasts the launch),
 * so everyone sees it, but only the server (or solo play) applies the damage. Arrows hurt animals
 * only, never other players.
 */

import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

import { WildAnimal } from '../animals/WildAnimal.js';
import { isAuthority } from '../systems/Net.js';

const MAX_STUCK = 5; // at most this many arrows stay embedded; a new one evicts the oldest

@ENGINE.GameClass()
export class ArrowProjectile extends ENGINE.SceneNode {
  // Shared FIFO pool of currently-stuck arrows across all instances.
  private static readonly stuckPool: ArrowProjectile[] = [];
  private readonly velocity = new THREE.Vector3();
  private gravity = 0;
  private travelled = 0;
  private maxDistance = 40;
  private maxLifetime = 6;
  private life = 0;
  private damage = 25;
  private ignoreRoot: ENGINE.SceneNode | null = null;
  private launched = false;
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpStep = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3(0, 0, 1);

  public launch(opts: {
    modelUrl: string;
    material?: string;
    modelScale: number;
    velocity: THREE.Vector3; // initial world velocity (already scaled)
    gravity: number;         // downward accel m/s^2 (already scaled)
    maxDistance: number;
    damage: number;
    ignoreRoot?: ENGINE.SceneNode | null;
  }): void {
    this.velocity.copy(opts.velocity);
    this.gravity = opts.gravity;
    this.maxDistance = opts.maxDistance;
    this.damage = opts.damage;
    this.ignoreRoot = opts.ignoreRoot ?? null;
    this.orientToVelocity();

    const mesh = ENGINE.ModelMeshNode.create({
      name: 'ArrowMesh',
      modelUrl: opts.modelUrl,
      ...(opts.material ? { material: opts.material } : {}),
      scale: new THREE.Vector3(opts.modelScale, opts.modelScale, opts.modelScale),
      physicsOptions: { enabled: false },
      castShadow: true,
    });
    this.add(mesh);

    this.canEverTick = true;
    this.launched = true;
  }

  /** The pawn that fired this arrow, if it was a pawn (credited as the animal's attacker). */
  private shooter(): ENGINE.Pawn | null {
    return this.ignoreRoot instanceof ENGINE.Pawn ? this.ignoreRoot : null;
  }

  private orientToVelocity(): void {
    if (this.velocity.lengthSq() < 1e-8) return;
    this.tmpDir.copy(this.velocity).normalize();
    // Arrow model long axis is +Z; point it along the flight direction.
    this.quaternion.setFromUnitVectors(this.fwd, this.tmpDir);
  }

  /** Freeze the arrow embedded at the impact point and register it in the shared FIFO pool. */
  private stick(point: THREE.Vector3): void {
    this.launched = false;
    this.canEverTick = false;
    // Sit at the impact, nudged a touch forward along the flight dir so the head buries in.
    const embed = this.tmpDir.copy(this.velocity).normalize().multiplyScalar(0.04);
    this.position.copy(point).add(embed);
    // Orientation already points along the incoming velocity (set last tick) — keep it.
    ArrowProjectile.registerStuck(this);
  }

  private static registerStuck(arrow: ArrowProjectile): void {
    ArrowProjectile.stuckPool.push(arrow);
    while (ArrowProjectile.stuckPool.length > MAX_STUCK) {
      ArrowProjectile.stuckPool.shift()?.removeFromParent();
    }
  }

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);
    if (!this.launched || deltaTime <= 0) return;

    this.life += deltaTime;

    // Proximity hit vs animals (they have no physics collider — kinematic bodies crash this build).
    const here = this.getWorldPosition(this.tmpPos);
    for (const animal of WildAnimal.alive) {
      if (animal.dead) {
        continue;
      }
      if (animal.containsPoint(here, 0.05)) {
        // The animal plays the hit sound itself (on every machine) when the server registers the hit.
        if (isAuthority()) animal.takeDamage(this.damage, this.shooter(), true);
        this.launched = false;
        this.canEverTick = false;
        this.removeFromParent(); // don't stick to the moving model — just vanish on an animal hit
        return;
      }
    }

    // Integrate gravity, then step.
    this.velocity.y -= this.gravity * deltaTime;
    this.tmpStep.copy(this.velocity).multiplyScalar(deltaTime);
    const step = this.tmpStep.length();
    const origin = this.getWorldPosition(this.tmpPos);

    const physics = this.getPhysicsEngine();
    if (physics && step > 1e-6) {
      const hit = physics.raycast({
        origin,
        direction: this.tmpDir.copy(this.tmpStep).normalize(),
        maxDistance: step,
        ignoredRootNodes: this.ignoreRoot ? [this.ignoreRoot] : undefined,
      });
      if (hit) {
        const target = hit.hitNode?.getRoot() ?? hit.hitNode;
        if (target instanceof WildAnimal && isAuthority()) target.takeDamage(this.damage, this.shooter(), true);
        this.stick(hit.hitLocation);
        return;
      }
    }

    this.position.add(this.tmpStep);
    this.orientToVelocity();
    this.travelled += step;
    if (this.travelled >= this.maxDistance || this.life >= this.maxLifetime) {
      this.removeFromParent();
    }
  }
}
