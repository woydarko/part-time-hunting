import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

import { RUN_DUST } from '../vfx/DustVfx.js';
import { ANIMALS, resolveDrops, type DropItem } from '../data/animals.js';
import { HuntSpawner } from '../nodes/HuntSpawner.js';
import { LootDrop } from '../nodes/LootDrop.js';
import { isAuthority, isOnline } from '../systems/Net.js';
import { Sfx } from '../systems/Sfx.js';
import type { SpeciesConfig } from '../data/species.js';

/** Deep-copy a VFX definition and scale spawn offsets / size / speed / gravity by `f`. */
function scaledVfx(def: unknown, f: number): unknown {
  const d = structuredClone(def) as { particles?: { gravity?: number[] }[]; emitters?: Record<string, number[]>[] };
  for (const p of d.particles ?? []) {
    if (Array.isArray(p.gravity)) p.gravity = p.gravity.map((v) => v * f);
  }
  for (const e of d.emitters ?? []) {
    for (const k of ['startPositionMin', 'startPositionMax', 'size', 'speed']) {
      if (Array.isArray(e[k])) e[k] = e[k].map((v) => v * f);
    }
  }
  return d;
}

// Tip bones (ground contact), not the ankle/knee — so the dust spawns at the hoof.
const FOOT_BONES = ['Front_foot_L_2_end', 'Front_Foot_R_2_end', 'Hind_Foot_L_1_end', 'Hind_Foot_R_1_end'];

// Death "tip-over" animation: the body rolls onto its side, sinks a touch, and fades out over
// DEATH_TOTAL seconds, then the node is removed. Roll is about the mesh's local X (the spine axis),
// so the animal lies on its flank instead of face-planting.
const DEATH_TOTAL = 2.4;                  // seconds from death to removal (ragdoll wobble + fade)
const DEATH_TIP_ANGLE = -Math.PI * 0.45;  // ~81 deg — onto its side, not fully flat (less stiff)
const DEATH_TIP_PORTION = 0.35;           // fraction of the timeline the body-fall takes
const DEATH_FADE_START = 0.6;             // fade begins at this fraction (lets the flop settle first)

/**
 * WildAnimal - one huntable animal (built in code, no prefab). It shows the animal GLB and drives a
 * locomotion animconfig via a `speed` parameter (0 = idle, >0.5 = walk, >3 = run), so the walk/run
 * cycle follows its actual movement with smooth blends.
 *
 * Behaviour is PROVOKED: it wanders peacefully until it takes damage, then reacts for
 * `provokeDuration` seconds — a flee animal (aggressive = false) runs away zigzag; an aggressive
 * animal chases and attacks. Configure per species with @property (the same class serves the two
 * flee animals and the two aggressive ones). Movement is kinematic (position-driven).
 *
 * Co-op: the server (or solo play) owns the animal. It runs the AI, takes damage, deals damage and
 * spawns the loot. Clients show it from a few replicated values (position, heading, speed, hit /
 * attack counters, dead flag). An aggressive animal chases whoever hit it, else the nearest player.
 */
@ENGINE.GameClass()
export class WildAnimal extends ENGINE.SceneNode {
  // ---- assets ----
  @ENGINE.property()
  public modelUrl: string = '@project/assets/models/rusa_anim.glb';
  @ENGINE.property()
  public animConfigUrl: string = '@project/assets/animations/rusa.animconfig.json';
  @ENGINE.property()
  public modelScale: number = 1;
  /** Correct yaw if the model doesn't face +Z (radians). */
  @ENGINE.property()
  public yawOffset: number = 0;
  /** Testing helper: if this node is left at the origin, spawn at the scene node with this name. */
  @ENGINE.property()
  public spawnMarkerName: string = 'AnimalSpawnPoint';
  /** Lateral offset from the spawn marker (world units) so multiple animals don't stack on it. */
  @ENGINE.property()
  public spawnOffsetX: number = 0;
  @ENGINE.property()
  public spawnOffsetZ: number = 0;

  // ---- stats / behaviour ----
  /** Species id from the ANIMALS economy table (rabbit/deer/boar/bear) — drives HP, aggression, drops. */
  @ENGINE.property()
  public species: string = 'deer';
  @ENGINE.property()
  public health: number = 60;
  /** true = chase + attack when hit; false = flee when hit. */
  @ENGINE.property()
  public aggressive: boolean = false;
  /** Seconds the animal stays provoked after being hit. */
  @ENGINE.property()
  public provokeDuration: number = 8;
  /** Skittish: flee (run) when the player comes within this distance. 0 = only react when hit (default). */
  @ENGINE.property()
  public fleeWhenNear: number = 0;

  @ENGINE.property()
  public wanderRadius: number = 12;
  @ENGINE.property()
  public wanderSpeed: number = 0.6;
  @ENGINE.property()
  public idleMinTime: number = 2;
  @ENGINE.property()
  public idleMaxTime: number = 5;
  @ENGINE.property()
  public fleeSpeed: number = 1.8;
  @ENGINE.property()
  public fleeZigzag: number = 1;
  @ENGINE.property()
  public chaseSpeed: number = 1.5;
  @ENGINE.property()
  public attackRange: number = 2;
  @ENGINE.property()
  public attackCooldown: number = 3;
  /** One-shot attack clip name (empty = no attack; deer/rabbit). */
  @ENGINE.property()
  public attackClip: string = '';
  @ENGINE.property()
  public attackDuration: number = 1.2;
  /** Damage dealt to the player when an aggressive animal's attack connects. */
  @ENGINE.property()
  public attackDamage: number = 15;
  /** Seconds into the attack when the damage lands — tune to the clip's actual strike frame (the paw
   *  swipe), so the hit is dodgeable instead of registering the instant the animation starts. */
  @ENGINE.property()
  public attackStrikeDelay: number = 0.6;
  /** Knockback launch strength applied to the player on hit (0 = use the pawn's default). */
  @ENGINE.property()
  public knockbackForce: number = 0;
  @ENGINE.property()
  public turnSpeed: number = 4;
  @ENGINE.property()
  public homeLeash: number = 30;
  /** Max ground step-up it will walk over (world units). Taller = a wall it won't climb. */
  @ENGINE.property()
  public maxStepUp: number = 0.25;
  /** Ground below this Y counts as water/void — the animal won't step there. */
  @ENGINE.property()
  public waterLevel: number = 0.2;
  /** How far ahead (world units) to probe the ground for walkability. */
  @ENGINE.property()
  public lookAhead: number = 1.0;
  /** Foot-dust particle scale (world units — tune to the animal size). */
  @ENGINE.property()
  public dustScale: number = 0.35;
  /** Comma-separated foot/hoof tip bone names to emit dust from (varies per species rig). */
  @ENGINE.property()
  public footBoneNames: string = 'Front_foot_L_2_end,Front_Foot_R_2_end,Hind_Foot_L_1_end,Hind_Foot_R_1_end';
  /** Hopping animals (rabbit): puff dust in bursts on each landing instead of a continuous trail. */
  @ENGINE.property()
  public hopDust: boolean = false;
  /** Seconds per hop (time between landings) when hopDust is on — drives both the bob and the puff. */
  @ENGINE.property()
  public hopPuffInterval: number = 0.55;
  /** Peak height of the procedural hop arc (world units). The hop clip's vertical is root motion the
   * animator strips, so we bob the mesh ourselves to make the hop visible instead of sliding. */
  @ENGINE.property()
  public hopHeight: number = 0.12;
  /** Hitbox size (world units) — tune to fit the model. */
  @ENGINE.property()
  public hitboxWidth: number = 0.5;
  @ENGINE.property()
  public hitboxHeight: number = 0.7;
  @ENGINE.property()
  public hitboxLength: number = 1.0;

  /** Set after death (read by a spawner to recount / respawn). */
  public dead: boolean = false;

  // ---- replicated state (server writes, clients display) ----
  @ENGINE.property({ replicate: true, transient: true, net: { netType: 'vector3', quantization: { mode: 'scale', scale: 100 } } })
  public netPos: THREE.Vector3 = new THREE.Vector3();
  @ENGINE.property({ replicate: true, transient: true, net: { netType: 'float', quantization: { mode: 'scale', scale: 100 } } })
  public netYaw: number = 0;
  @ENGINE.property({ replicate: true, transient: true, net: { netType: 'float', quantization: { mode: 'scale', scale: 100 }, epsilon: 2 } })
  public netSpeed: number = 0;
  /** Bumped by the server on every non-lethal hit; clients flash red + play the hit sound. */
  @ENGINE.property({ replicate: true, transient: true, net: { netType: 'uint' } })
  public netHitSeq: number = 0;
  /** Whether the latest hit was an arrow (picks the hit sound on clients). */
  @ENGINE.property({ replicate: true, transient: true, net: { netType: 'bool' } })
  public netHitByArrow: boolean = false;
  /** Bumped by the server each time the animal starts an attack; clients play the attack clip. */
  @ENGINE.property({ replicate: true, transient: true, net: { netType: 'uint' } })
  public netAttackSeq: number = 0;
  @ENGINE.property({ replicate: true, transient: true, net: { netType: 'bool' } })
  public netDead: boolean = false;
  /** Client: a server position has arrived (until then, keep the spawn position). */
  private hasNetPos = false;

  /** All living animals — arrows scan these for proximity hits (no physics collider). */
  public static readonly alive: WildAnimal[] = [];

  /** Fired once when any animal dies (the pawn subscribes to grant its loot drops). */
  public static onKilled: ((animal: WildAnimal) => void) | null = null;

  /** Build the scene navmesh only once across all animals. */
  private static navBuildStarted = false;

  // Nav path-following (used when chasing so it routes around collision instead of wedging).
  private navPath: THREE.Vector3[] = [];
  private navIndex = 0;
  private navRepathTimer = 0;

  /** The concrete loot items this animal drops on death (resolved from its species). */
  public getDropItems(): DropItem[] {
    return resolveDrops(this.species);
  }

  private fitted: boolean = false;
  private fittedRadius: number = 0.6;
  private fittedCenterY: number = 0.4;
  private fittedMinY: number = 0;   // feet, relative to node origin
  private fittedMaxY: number = 0.8; // top of the model, relative to node origin

  /** World-space center of the hitbox (for melee direction/dist) — auto-fit to the model. */
  public getHitCenter(out: THREE.Vector3): THREE.Vector3 {
    this.getWorldPosition(out);
    out.y += this.fitted ? this.fittedCenterY : this.hitboxHeight * 0.5;
    return out;
  }

  /** Hit radius (world units) — auto-fit to the model's bounding box once loaded. */
  public getHitRadius(): number {
    return this.fitted ? this.fittedRadius : Math.max(this.hitboxWidth, this.hitboxLength, this.hitboxHeight) * 0.6;
  }

  /**
   * Vertical-capsule hit test used by arrows: inside the horizontal radius AND within the model's
   * feet→top Y span (+pad). Unlike a sphere at body-center, this reaches all the way down to the
   * legs, so low shots connect instead of passing under the animal.
   */
  public containsPoint(p: THREE.Vector3, pad = 0): boolean {
    const base = this.getWorldPosition(this.tmpBase);
    const dx = p.x - base.x;
    const dz = p.z - base.z;
    const r = this.getHitRadius() + pad;
    if (dx * dx + dz * dz > r * r) {
      return false;
    }
    const lo = base.y + (this.fitted ? this.fittedMinY : 0) - pad;
    const hi = base.y + (this.fitted ? this.fittedMaxY : this.hitboxHeight) + pad;
    return p.y >= lo && p.y <= hi;
  }
  private readonly tmpBase = new THREE.Vector3();

  /** Fit the proximity hitbox to the loaded model's world bounding box. */
  private fitHitbox(mesh: ENGINE.ModelMeshNode): void {
    mesh.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(mesh);
    if (box.isEmpty()) {
      return;
    }
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const nodePos = this.getWorldPosition(new THREE.Vector3());
    // Horizontal half-extent covers the body; the Y span covers feet→top so legs are hittable too.
    this.fittedRadius = Math.max(size.x, size.z) * 0.5;
    this.fittedCenterY = center.y - nodePos.y;
    this.fittedMinY = box.min.y - nodePos.y;
    this.fittedMaxY = box.max.y - nodePos.y;
    this.fitted = true;
  }

  private animationNode: ENGINE.AnimationStateMachineNode | null = null;
  private meshNode: ENGINE.ModelMeshNode | null = null;
  private readonly footDust: ENGINE.VFXNode[] = [];
  private dustEmitting: boolean = false;
  private hopClock: number = 0;     // seconds into the current hop (hopDust mode)
  private puffOffTimer: number = 0; // remaining emit window of the current puff
  private deathFade: number = -1; // >0 while waiting for foot dust to expire before removal
  private lastSpeed: number = 0;
  private hp: number = -1;
  private onDeath: (() => void) | null = null;
  private wanderTimeLimit: number = 5;
  private flashTimer: number = 0;
  private readonly flashMats = new Set<{ emissive?: { setHex: (h: number) => void } }>();
  // Cloned materials used only for the death fade (cloned so the shared cached material isn't left
  // transparent for the next spawned animal).
  private readonly deathMats = new Set<{ opacity: number; transparent: boolean }>();
  // Ragdoll: per-bone damped springs on the SAME mesh (no new body) — bones wobble then go limp.
  private readonly ragdollBones: { bone: THREE.Object3D; base: THREE.Euler; limp: THREE.Vector3; vel: THREE.Vector3 }[] = [];

  private state: 'idle' | 'wander' | 'flee' | 'chase' = 'idle';
  private stateTime: number = 0;
  private idleDuration: number = 2;
  private legSpeed: number = 1.5;
  private provokeTimer: number = 0;
  private fleeTime: number = 0;
  private attackTimer: number = 0;
  private attackLock: number = 0;
  private attackStrikeTimer: number = -1; // >0 = counting down to the attack's damage frame
  private playerQueryTimer: number = 0;
  private player: ENGINE.Pawn | null = null;
  /** The player who last hit this animal (chased / fled from while provoked). */
  private aggroTarget: ENGINE.Pawn | null = null;
  private readonly target = { x: 0, z: 0 };
  private readonly home = { x: 0, y: 0, z: 0 };
  // Stuck detection: if it's trying to move but makes no ground over a window, force a hard reroute.
  private readonly stuckAnchor = { x: 0, z: 0 };
  private stuckTimer = 0;

  constructor() {
    super();
    this.canEverTick = true;
    // Its own replicated entity, spawned by HuntSpawner on the server and mirrored on clients.
    this.isRoot = true;
    this.replicated = true;
  }

  public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }
    // Species drives the economy stats (HP + aggression) — one source of truth for all four animals.
    const cfg = ANIMALS[this.species];
    if (cfg) {
      this.health = cfg.hp;
      this.aggressive = cfg.aggressive;
    }
    // Build the visual + animation children in code (no prefab).
    const mesh = ENGINE.ModelMeshNode.create({
      name: 'AnimalMesh',
      modelUrl: this.modelUrl,
      physicsOptions: { enabled: false }, // skinned-mesh physics crashes; hitbox is a separate box below
      castShadow: true,
    });
    mesh.scale.setScalar(this.modelScale);
    this.add(mesh);
    this.meshNode = mesh;
    // Once the geometry loads: fit the hitbox + attach foot-dust to the leg bones.
    const onLoaded = () => {
      this.fitHitbox(mesh);
      this.setupFootDust(mesh);
    };
    if (mesh.isModelLoaded?.()) {
      onLoaded();
    } else {
      mesh.onMeshLoaded?.add(() => onLoaded());
    }
    // Register as a huntable target — arrows check these by proximity (no physics collider, since
    // kinematic bodies crash this engine build).
    WildAnimal.alive.push(this);
    const anim = ENGINE.AnimationStateMachineNode.create({ name: 'AnimalAnim', configUrl: this.animConfigUrl });
    this.add(anim);
    this.animationNode = anim;

    // Testing bridge: scene-authored transform on this class doesn't persist (reverts to origin),
    // so if we're at the origin, teleport to the named marker node's world position instead.
    if (this.position.lengthSq() < 0.01 && this.spawnMarkerName) {
      const marker = this.findNodeByName(this.spawnMarkerName);
      if (marker) {
        const p = marker.getWorldPosition(new THREE.Vector3());
        this.position.set(p.x + this.spawnOffsetX, p.y, p.z + this.spawnOffsetZ);
      }
    }

    // Build a navmesh from the static scene geometry once, so aggressive animals can path around
    // obstacles when chasing instead of wedging against them (fire-and-forget; chase falls back to
    // straight-line steering until it's ready).
    // Only the machine that runs the AI needs the navmesh (clients just display the animal).
    if (!WildAnimal.navBuildStarted && isAuthority()) {
      WildAnimal.navBuildStarted = true;
      const world = this.getWorld();
      const nav = world?.gameLoop?.navigationServer;
      if (nav) {
        // Default Recast cellSize is 1 unit (coarse) with a 1-cell erosion, which quantizes/closes
        // real gaps so paths detour around them. Use a finer grid + smaller erosion so gaps the
        // animal actually fits through stay walkable in the navmesh.
        nav.updateOptions?.({ cs: 0.35, ch: 0.2, walkableRadius: 1, minRegionArea: 3 });
        world.createNavigationMeshFromScene().catch((e) => console.warn('[WildAnimal] navmesh build failed', e));
      }
    }

    this.home.x = this.position.x;
    this.home.y = this.position.y;
    this.home.z = this.position.z;
    this.idleDuration = this.randomRange(this.idleMinTime, this.idleMaxTime);
    this.setTickEnabled(true);
    return true;
  }

  public override endPlay(): boolean {
    // A level unload (back to the menu, leaving co-op) removes live animals without a death; drop
    // them here so arrows and melee in the next session never hit ghosts at their old positions.
    const i = WildAnimal.alive.indexOf(this);
    if (i >= 0) WildAnimal.alive.splice(i, 1);
    return super.endPlay();
  }

  public setOnDeath(cb: () => void): void {
    this.onDeath = cb;
  }

  /**
   * Build (not add) a WildAnimal from a species config at a world position. HuntSpawner adds it on the
   * server and on every client, so all of them run this with the same arguments.
   */
  public static fromConfig(cfg: SpeciesConfig, x: number, y: number, z: number): WildAnimal {
    const a = WildAnimal.create({ name: `Animal_${cfg.species}` }) as WildAnimal;
    a.species = cfg.species;
    a.modelUrl = cfg.modelUrl;
    a.animConfigUrl = cfg.animConfigUrl;
    a.modelScale = cfg.modelScale;
    a.yawOffset = cfg.yawOffset;
    a.footBoneNames = cfg.footBoneNames;
    a.hopDust = cfg.hopDust;
    if (cfg.hopPuffInterval != null) a.hopPuffInterval = cfg.hopPuffInterval;
    if (cfg.hopHeight != null) a.hopHeight = cfg.hopHeight;
    if (cfg.dustScale != null) a.dustScale = cfg.dustScale;
    if (cfg.attackClip != null) a.attackClip = cfg.attackClip;
    if (cfg.attackRange != null) a.attackRange = cfg.attackRange;
    if (cfg.attackCooldown != null) a.attackCooldown = cfg.attackCooldown;
    if (cfg.attackDuration != null) a.attackDuration = cfg.attackDuration;
    if (cfg.attackDamage != null) a.attackDamage = cfg.attackDamage;
    if (cfg.attackStrikeDelay != null) a.attackStrikeDelay = cfg.attackStrikeDelay;
    if (cfg.chaseSpeed != null) a.chaseSpeed = cfg.chaseSpeed;
    if (cfg.knockbackForce != null) a.knockbackForce = cfg.knockbackForce;
    a.spawnMarkerName = ''; // placed directly — don't teleport to a marker
    a.position.set(x, y, z);
    a.netPos.set(x, y, z);
    return a;
  }

  private panicBoost: number = 0;

  /**
   * Server / solo only: apply a hit. `attacker` (the hitting player's pawn) becomes the chase / flee
   * target, so in co-op the animal reacts to whoever hit it. Calls on a client are ignored.
   */
  public takeDamage(amount: number, attacker: ENGINE.Pawn | null = null, byArrow = false): void {
    if (this.dead || !this.hasAuthority()) {
      return;
    }
    if (attacker) {
      this.player = attacker;
      this.aggroTarget = attacker;
    }
    if (this.hp < 0) {
      this.hp = this.health;
    }
    this.hp -= amount;
    if (this.hp <= 0) {
      this.die(); // lethal hit: no red flash — go straight to the limp ragdoll
      return;
    }
    this.netHitByArrow = byArrow;
    this.netHitSeq++;
    this.flashRed();
    this.playHitSfx();
    // Survived the hit -> get provoked (flee or turn aggressive), a little faster each hit (panic).
    this.provokeTimer = this.provokeDuration;
    // Bigger panic burst so a hit animal quickly pulls away — after a swing or two it's out of melee
    // range and you need a bow to finish it (encourages ranged, matches the hunting loop).
    this.panicBoost = Math.min(this.panicBoost + 0.8, 2.5);
    this.state = this.aggressive ? 'chase' : 'flee';
    this.stateTime = 0;
    this.fleeTime = 0;
    this.navRepathTimer = 0; // repath immediately for the new goal
    this.playReactionSfx();  // aggro (boar/bear chasing) or run (deer fleeing)
  }

  /** Hit sound at the animal (arrow thunk or melee crunch). */
  private playHitSfx(): void {
    const pos = this.getWorldPosition(new THREE.Vector3());
    if (this.netHitByArrow) Sfx.play3d('arrowHit', pos, 0.9);
    else Sfx.play3d('hitAnimal', pos, 0.7);
  }

  /** Client: the server registered a non-lethal hit. */
  public onRepNetHitSeq(): void {
    if (this.dead) return;
    this.flashRed();
    this.playHitSfx();
    this.state = this.aggressive ? 'chase' : 'flee'; // only picks the reaction sound on clients
    this.playReactionSfx();
  }

  /** Client: the server killed this animal. */
  public onRepNetDead(): void {
    if (this.netDead) this.die();
  }

  /** Client: the server started an attack. */
  public onRepNetAttackSeq(): void {
    if (!this.dead) this.playAttackAnim();
  }

  /** Client: a server position update arrived. */
  public onRepNetPos(): void {
    this.hasNetPos = true;
  }

  /** Tint the model red briefly to signal a hit. */
  private flashRed(): void {
    this.flashTimer = 0.15;
    if (this.flashMats.size === 0 && this.meshNode) {
      // Clone to per-instance materials first: same-species animals share the cached GLTF's
      // materials, so tinting a shared material would flash EVERY rabbit at once. Cloning + reassigning
      // isolates this animal's flash.
      this.meshNode.traverse((o) => {
        const holder = o as unknown as { material?: unknown };
        const mat = holder.material;
        if (!mat) return;
        const cloneOne = (m: unknown) => (m as { clone?: () => unknown }).clone?.() ?? m;
        const cloned = Array.isArray(mat) ? mat.map(cloneOne) : cloneOne(mat);
        holder.material = cloned;
        for (const m of Array.isArray(cloned) ? cloned : [cloned]) {
          const em = (m as { emissive?: { setHex: (h: number) => void } })?.emissive;
          if (em) this.flashMats.add(m as { emissive?: { setHex: (h: number) => void } });
        }
      });
    }
    for (const m of this.flashMats) {
      m.emissive?.setHex(0xff2020);
    }
  }

  /** Play the species chase/flee reaction sound (throttled so repeated hits don't spam it). */
  private reactionSfxAt = 0;
  private playReactionSfx(): void {
    const now = performance.now();
    if (now - this.reactionSfxAt < 1500) return;
    this.reactionSfxAt = now;
    const pos = this.getWorldPosition(new THREE.Vector3());
    if (this.state === 'chase') {
      if (this.species === 'boar') Sfx.play3d('boarAggro', pos, 0.8);
      else if (this.species === 'bear') Sfx.play3d('bearAggro', pos, 0.85);
    } else if (this.state === 'flee' && this.species === 'deer') {
      Sfx.play3d('deerRun', pos, 0.7);
    }
  }

  private die(): void {
    if (this.dead) {
      return;
    }
    const deathSfx = { rabbit: 'rabbitDeath', deer: 'deerDeath', boar: 'boarDeath', bear: 'bearDeath' } as const;
    Sfx.play3d(deathSfx[this.species as keyof typeof deathSfx] ?? 'animalDeath', this.getWorldPosition(new THREE.Vector3()), 0.85);
    this.dead = true;
    if (this.hasAuthority()) this.netDead = true;
    const i = WildAnimal.alive.indexOf(this);
    if (i >= 0) {
      WildAnimal.alive.splice(i, 1);
    }
    this.onDeath?.();
    WildAnimal.onKilled?.(this); // notify (kill count / respawn hooks)
    // Burst physical loot out of the corpse (falls, collides, slides, then pick up by interact).
    const world = this.getWorld();
    const drops = this.getDropItems();
    if (world && drops.length > 0 && isAuthority()) {
      const p = this.getWorldPosition(new THREE.Vector3());
      // Defer the loot burst one frame: keeps the death frame (sound + ragdoll setup) light so the
      // GLTF clones + ground raycasts of the drops don't spike into a visible freeze.
      setTimeout(() => { try { LootDrop.spawnBurst(world, p.x, p.y, p.z, drops); } catch { /* world gone */ } }, 0);
    }
    // Stop kicking up dust; keep the body visible and play the tip-over/fade death animation over
    // DEATH_TOTAL (also outlasts the RUN_DUST particle lifetime so the trail dust expires in place).
    for (const v of this.footDust) {
      v.stopEmitting();
    }
    this.dustEmitting = false;
    this.setLocomotion(0);
    this.captureDeathMaterials();
    this.setupRagdoll(); // free the bones + seed the limp wobble
    this.deathFade = DEATH_TOTAL;
  }

  /**
   * Ragdoll on the SAME mesh: stop the animator posing the skeleton, then give each bone a damped
   * angular spring toward a slightly-splayed "limp" pose. It wobbles and settles like a floppy
   * corpse — no new body/model, no engine physics (which crashes on these animals).
   */
  private setupRagdoll(): void {
    // Clear any lingering hit-flash so the corpse isn't red.
    this.flashTimer = 0;
    for (const m of this.flashMats) {
      m.emissive?.setHex(0x000000);
    }
    // Free the bones: disable every mixer action (so it writes nothing to the skeleton) AND stop the
    // animator ticking. Then our per-bone ragdoll writes actually stick instead of being overridden.
    const actions = this.animationNode?.getActionsMap?.();
    if (actions) {
      for (const a of actions.values()) {
        a.enabled = false;
      }
    }
    this.animationNode?.setTickEnabled(false);
    if (!this.meshNode) {
      return;
    }
    this.meshNode.traverse((o) => {
      const bone = o as THREE.Object3D & { isBone?: boolean };
      const parent = bone.parent as (THREE.Object3D & { isBone?: boolean }) | null;
      if (!bone.isBone || !parent?.isBone) {
        return; // skip non-bones and root bones (the body itself collapses via the mesh tip)
      }
      const r = () => (Math.random() - 0.5);
      this.ragdollBones.push({
        bone,
        base: bone.rotation.clone(),
        limp: new THREE.Vector3(r() * 0.5, r() * 0.4, r() * 0.5),   // final splayed rest offset
        vel: new THREE.Vector3(r() * 7, r() * 5, r() * 7),          // initial kick (limbs fling out)
      });
    });
  }

  /** Clone the mesh's materials so the death fade can lower opacity without touching shared assets. */
  private captureDeathMaterials(): void {
    if (!this.meshNode) {
      return;
    }
    this.meshNode.traverse((o) => {
      const holder = o as unknown as { material?: unknown };
      const mat = holder.material;
      if (!mat) {
        return;
      }
      const cloneOne = (m: unknown) => {
        const c = (m as { clone?: () => unknown }).clone?.() as { opacity: number; transparent: boolean } | undefined;
        if (!c) {
          return m;
        }
        c.transparent = true;
        this.deathMats.add(c);
        return c;
      };
      holder.material = Array.isArray(mat) ? mat.map(cloneOne) : cloneOne(mat);
    });
  }

  /** Advance the body collapse + per-bone ragdoll wobble + fade. `t` is the normalized timeline. */
  private applyDeathAnim(t: number, deltaTime: number): void {
    const mesh = this.meshNode;
    if (!mesh) {
      return;
    }
    // Body: tip onto its side (pivots at the feet, which sit on the ground — no downward sink, or it
    // would push the corpse through the terrain).
    const rt = Math.min(1, t / DEATH_TIP_PORTION);
    const fall = 1 - (1 - rt) * (1 - rt); // easeOutQuad
    mesh.rotation.x = DEATH_TIP_ANGLE * fall;
    mesh.position.y = 0;

    // Bones: damped spring toward the limp rest pose (initial kick makes limbs fling, then settle).
    const dt = Math.min(deltaTime, 0.05);
    const SPRING = 55;
    const DAMP = Math.exp(-7 * dt);
    for (const rb of this.ragdollBones) {
      const rot = rb.bone.rotation;
      rb.vel.x += -(rot.x - (rb.base.x + rb.limp.x)) * SPRING * dt;
      rb.vel.y += -(rot.y - (rb.base.y + rb.limp.y)) * SPRING * dt;
      rb.vel.z += -(rot.z - (rb.base.z + rb.limp.z)) * SPRING * dt;
      rb.vel.multiplyScalar(DAMP);
      rot.x += rb.vel.x * dt;
      rot.y += rb.vel.y * dt;
      rot.z += rb.vel.z * dt;
    }

    // Fade out toward the end.
    const fadeT = Math.max(0, (t - DEATH_FADE_START) / (1 - DEATH_FADE_START));
    const opacity = Math.max(0, 1 - fadeT);
    for (const m of this.deathMats) {
      m.opacity = opacity;
    }
  }

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);
    if (this.dead) {
      // Post-death: play the tip-over/sink/fade, then remove the node.
      if (this.deathFade > 0 && deltaTime > 0) {
        this.deathFade -= deltaTime;
        this.applyGroundY(); // keep the corpse resting on the terrain (don't clip through)
        this.applyDeathAnim(1 - Math.max(0, this.deathFade) / DEATH_TOTAL, deltaTime);
        // The server removes the corpse for everyone; a client keeps its faded copy until then.
        if (this.deathFade <= 0 && this.hasAuthority()) {
          const spawner = HuntSpawner.find(this.getWorld());
          if (!spawner?.despawnInstance(this)) this.removeFromParent();
        }
      }
      return;
    }
    if (deltaTime <= 0) {
      return;
    }
    if (!this.hasAuthority()) {
      this.tickProxy(deltaTime);
      return;
    }
    this.refreshPlayer(deltaTime);
    if (this.flashTimer > 0) {
      this.flashTimer -= deltaTime;
      if (this.flashTimer <= 0) {
        for (const m of this.flashMats) {
          m.emissive?.setHex(0x000000);
        }
      }
    }
    this.attackTimer = Math.max(0, this.attackTimer - deltaTime);
    this.attackLock = Math.max(0, this.attackLock - deltaTime);
    // Land the attack's damage at the strike frame (mid-swing), if the player is still in reach.
    if (this.attackStrikeTimer > 0) {
      this.attackStrikeTimer -= deltaTime;
      if (this.attackStrikeTimer <= 0) {
        this.attackStrikeTimer = -1;
        this.dealAttackDamage();
      }
    }
    if (this.provokeTimer > 0) {
      this.provokeTimer -= deltaTime;
      if (this.provokeTimer <= 0 && (this.state === 'flee' || this.state === 'chase')) {
        this.enterIdle(); // calmed down
      }
    }

    // Skittish flee: run off when the player gets too close (flee animals only).
    if (this.fleeWhenNear > 0 && !this.aggressive && this.state !== 'flee' && this.player) {
      const d = Math.hypot(this.player.position.x - this.position.x, this.player.position.z - this.position.z);
      if (d <= this.fleeWhenNear) {
        this.state = 'flee';
        this.playReactionSfx(); // deer run/flee cry
        this.stateTime = 0;
        this.fleeTime = 0;
      }
    }

    if (this.attackLock > 0) {
      this.setLocomotion(0);
      return;
    }
    this.stateTime += deltaTime;
    switch (this.state) {
      case 'idle':
        if (this.stateTime >= this.idleDuration) {
          this.enterWander();
        } else {
          this.setLocomotion(0);
        }
        break;
      case 'wander':
        if (this.moveTowardNav(this.target.x, this.target.z, this.legSpeed, deltaTime) || this.stateTime > this.wanderTimeLimit) {
          this.enterIdle(); // reached the spot (or gave up) -> pause and look around
        }
        break;
      case 'flee':
        this.updateFlee(deltaTime);
        break;
      case 'chase':
        this.updateChase(deltaTime);
        break;
    }
    this.updateStuck(deltaTime); // hard-unstick if it's wedged against a collider
    this.applyGroundY(); // sit on the terrain regardless of state

    // Foot dust: hopping animals puff on each landing; others trail continuously while moving.
    const moving = this.lastSpeed > 0.3;
    if (this.hopDust) {
      this.updateHopPuff(moving, deltaTime);
    } else if (moving && !this.dustEmitting) {
      for (const v of this.footDust) {
        v.startEmitting();
      }
      this.dustEmitting = true;
    } else if (!moving && this.dustEmitting) {
      for (const v of this.footDust) {
        v.stopEmitting();
      }
      this.dustEmitting = false;
    }

    // Publish the result for clients (no-op cost in solo play: nothing is sent).
    if (isOnline()) {
      this.netPos.copy(this.position);
      this.netYaw = this.rotation.y;
      this.netSpeed = this.lastSpeed;
    }
  }

  /**
   * Client tick: glide toward the server's position and heading, and drive the walk/run blend and
   * the foot dust from the server's speed. No AI runs here.
   */
  private tickProxy(deltaTime: number): void {
    if (this.flashTimer > 0) {
      this.flashTimer -= deltaTime;
      if (this.flashTimer <= 0) {
        for (const m of this.flashMats) {
          m.emissive?.setHex(0x000000);
        }
      }
    }
    if (this.hasNetPos) {
      // Exponential smoothing hides the gaps between ~30 Hz server updates.
      const k = 1 - Math.exp(-12 * deltaTime);
      if (this.position.distanceToSquared(this.netPos) > 25) this.position.copy(this.netPos); // big jump: snap
      else this.position.lerp(this.netPos, k);
      let diff = this.netYaw - this.rotation.y;
      while (diff > Math.PI) { diff -= Math.PI * 2; }
      while (diff < -Math.PI) { diff += Math.PI * 2; }
      this.rotation.y += diff * k;
    }
    this.setLocomotion(this.netSpeed);
    const moving = this.lastSpeed > 0.3;
    if (this.hopDust) {
      this.updateHopPuff(moving, deltaTime);
    } else if (moving !== this.dustEmitting) {
      for (const v of this.footDust) {
        if (moving) v.startEmitting();
        else v.stopEmitting();
      }
      this.dustEmitting = moving;
    }
  }

  /**
   * Hop-dust mode: bob the mesh in an arc (so the hop reads as a hop, not a slide) and puff dust
   * from the feet at each landing. One clock drives both — landings at the start of each cycle.
   */
  private updateHopPuff(moving: boolean, deltaTime: number): void {
    const mesh = this.meshNode;
    if (!moving) {
      if (this.dustEmitting) {
        for (const v of this.footDust) v.stopEmitting();
        this.dustEmitting = false;
      }
      this.hopClock = 0;
      this.puffOffTimer = 0;
      if (mesh) mesh.position.y = 0;
      return;
    }
    // Close the previous puff's short emit window.
    if (this.puffOffTimer > 0) {
      this.puffOffTimer -= deltaTime;
      if (this.puffOffTimer <= 0 && this.dustEmitting) {
        for (const v of this.footDust) v.stopEmitting();
        this.dustEmitting = false;
      }
    }
    // Advance the hop clock; a fresh landing puffs dust.
    this.hopClock += deltaTime;
    if (this.hopClock >= this.hopPuffInterval) {
      this.hopClock -= this.hopPuffInterval;
      for (const v of this.footDust) v.startEmitting(true); // burst on landing
      this.dustEmitting = true;
      this.puffOffTimer = 0.12;
    }
    // Vertical hop arc: 0 at both landings, peak mid-hop.
    if (mesh) {
      const t = this.hopClock / Math.max(0.001, this.hopPuffInterval);
      mesh.position.y = this.hopHeight * Math.sin(Math.PI * t);
    }
  }

  // ---- behaviour helpers ----

  private enterIdle(duration?: number): void {
    this.state = 'idle';
    this.stateTime = 0;
    this.idleDuration = duration ?? this.randomRange(this.idleMinTime, this.idleMaxTime);
    this.panicBoost = 0; // calmed down
    this.setLocomotion(0);
  }

  private enterWander(): void {
    this.state = 'wander';
    this.stateTime = 0;
    this.navRepathTimer = 0;
    this.pickWanderTarget();
    this.legSpeed = Math.max(0.6, this.wanderSpeed * this.randomRange(0.75, 1.25));
    // Cap how long one wander leg lasts so it stops to idle even if it can't reach the target.
    this.wanderTimeLimit = this.randomRange(3, 7);
  }

  private updateFlee(deltaTime: number): void {
    if (!this.player) {
      this.enterIdle();
      return;
    }
    const dx = this.position.x - this.player.position.x;
    const dz = this.position.z - this.player.position.z;
    const dist = Math.max(0.001, Math.hypot(dx, dz));
    // Stop fleeing once safely away (and no longer provoked by a hit).
    if (this.provokeTimer <= 0 && this.fleeWhenNear > 0 && dist > this.fleeWhenNear * 1.6) {
      this.enterIdle();
      return;
    }
    this.fleeTime += deltaTime;
    const px = -dz / dist;
    const pz = dx / dist;
    const sway = Math.sin(this.fleeTime * 5) * this.fleeZigzag;
    this.moveTowardNav(
      this.position.x + (dx / dist) * 8 + px * sway,
      this.position.z + (dz / dist) * 8 + pz * sway,
      this.fleeSpeed + this.panicBoost,
      deltaTime,
    );
  }

  private updateChase(deltaTime: number): void {
    if (!this.player) {
      this.enterIdle();
      return;
    }
    const dist = Math.hypot(this.player.position.x - this.position.x, this.player.position.z - this.position.z);
    if (this.attackRange > 0 && dist <= this.attackRange) {
      this.facePoint(this.player.position.x, this.player.position.z, 1);
      this.setLocomotion(0);
      if (this.attackTimer <= 0) {
        this.playAttack();
        this.attackTimer = this.attackCooldown;
        this.attackLock = this.attackDuration;
      }
      return;
    }
    this.moveTowardNav(this.player.position.x, this.player.position.z, this.chaseSpeed, deltaTime);
  }

  /**
   * Like moveToward, but routes via the navmesh (A* path) so it goes AROUND collision toward the
   * target instead of wedging. Recomputes the path a few times a second (the target moves) and
   * steers to the next waypoint. Falls back to straight-line steering when the navmesh isn't ready.
   */
  private moveTowardNav(destX: number, destZ: number, speed: number, deltaTime: number): boolean {
    const nav = this.getWorld()?.gameLoop?.navigationServer;
    if (!nav) {
      return this.moveToward(destX, destZ, speed, deltaTime); // navmesh not ready
    }
    const here = new THREE.Vector3(this.position.x, this.position.y, this.position.z);
    this.navRepathTimer -= deltaTime;
    if (this.navRepathTimer <= 0 || this.navPath.length < 2) {
      // Snap BOTH ends onto the mesh (start Y often differs slightly from the poly → don't gate on
      // isPointOnNavigationMesh, just project), then A* between them.
      const start = nav.getClosestPointOnNavigationMesh(here);
      const dest = nav.getClosestPointOnNavigationMesh(new THREE.Vector3(destX, this.position.y, destZ));
      this.navPath = nav.calculatePath(start, dest) ?? [];
      this.navIndex = 1; // index 0 is the start point itself
      this.navRepathTimer = 0.4;
    }
    // No usable multi-point path → steer straight (open ground, or navmesh couldn't route).
    if (this.navPath.length < 2) {
      return this.moveToward(destX, destZ, speed, deltaTime);
    }
    // Advance past waypoints we've effectively reached.
    let wp = this.navPath[this.navIndex];
    while (wp && this.navIndex < this.navPath.length - 1 &&
           Math.hypot(wp.x - this.position.x, wp.z - this.position.z) < 0.6) {
      wp = this.navPath[++this.navIndex];
    }
    if (!wp) {
      return this.moveToward(destX, destZ, speed, deltaTime);
    }
    // Follow the nav waypoint WITHOUT the obstacle probe/reroute — the navmesh already guarantees the
    // segment is walkable, so the local probe would otherwise trip on a nearby wall and spin us.
    return this.stepToward(wp.x, wp.z, speed, deltaTime);
  }

  /** Turn toward a point then step forward along the facing — no walkability probe, no reroute. */
  private stepToward(x: number, z: number, speed: number, deltaTime: number): boolean {
    const dist = Math.hypot(x - this.position.x, z - this.position.z);
    if (dist < 0.3) {
      this.setLocomotion(0);
      return true;
    }
    if (!this.facePoint(x, z, deltaTime)) {
      this.setLocomotion(0); // pivot in place first
      return false;
    }
    const fx = Math.sin(this.rotation.y - this.yawOffset);
    const fz = Math.cos(this.rotation.y - this.yawOffset);
    const step = Math.min(speed * deltaTime, dist);
    this.position.x += fx * step;
    this.position.z += fz * step;
    this.setLocomotion(speed);
    return false;
  }

  // ---- animation ----

  private setLocomotion(speed: number): void {
    this.lastSpeed = speed;
    this.animationNode?.setParameter('speed', speed);
  }

  /** Attach a foot-dust VFX to each of the four foot bones (follows the animated feet). */
  private setupFootDust(mesh: ENGINE.ModelMeshNode): void {
    if (this.footDust.length > 0) {
      return;
    }
    const bones = this.footBoneNames.split(',').map((s) => s.trim()).filter(Boolean);
    for (const boneName of (bones.length > 0 ? bones : FOOT_BONES)) {
      const bone = mesh.getObjectByName(boneName);
      if (!bone) {
        continue;
      }
      const vfx = ENGINE.VFXNode.create({
        name: `FootDust_${boneName}`,
        vfxDefinition: ENGINE.VFXDefinition.fromJSON(scaledVfx(RUN_DUST, this.dustScale) as never),
        autoStart: false,
      });
      bone.add(vfx);
      this.footDust.push(vfx);
    }
  }

  /** Server / solo: start an attack (clients play the clip from netAttackSeq). */
  private playAttack(): void {
    if (this.attackClip === '' || !this.animationNode?.isReady()) {
      return;
    }
    this.netAttackSeq++;
    this.playAttackAnim();
    this.attackStrikeTimer = this.attackStrikeDelay; // damage lands at the clip's real strike frame
  }

  /** Play the one-shot attack clip (all machines). */
  private playAttackAnim(): void {
    const node = this.animationNode;
    if (!node || !node.isReady() || this.attackClip === '') {
      return;
    }
    node.setParameter('attack', 1);
    // Auto-clear after the clip; simplest: a short timer via attackLock handled by caller.
    setTimeout(() => node.setParameter('attack', 0), this.attackDuration * 1000);
  }

  /** Deal the attack's damage to the player if still within (a little beyond) attack range. */
  private dealAttackDamage(): void {
    const target = this.player as unknown as { takeDamage?: (n: number, from?: THREE.Vector3, force?: number) => void } | null;
    if (!this.player || !target?.takeDamage) {
      return;
    }
    const dist = Math.hypot(this.player.position.x - this.position.x, this.player.position.z - this.position.z);
    if (dist <= this.attackRange * 1.3) {
      // Pass our position (knock the player AWAY) + our per-species knockback strength (0 = default).
      const from = new THREE.Vector3(this.position.x, this.position.y, this.position.z);
      target.takeDamage(this.attackDamage, from, this.knockbackForce > 0 ? this.knockbackForce : undefined);
    }
  }

  // ---- movement ----

  private moveToward(x: number, z: number, speed: number, deltaTime: number): boolean {
    const dx = x - this.position.x;
    const dz = z - this.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.3) {
      this.setLocomotion(0);
      return true;
    }
    // Turn to face the target FIRST; only advance (along the facing direction, never sideways)
    // once roughly aligned — so the animal pivots then walks instead of sliding.
    const aligned = this.facePoint(x, z, deltaTime);
    if (!aligned) {
      this.setLocomotion(0); // pivoting in place
      return false;
    }
    const fx = Math.sin(this.rotation.y - this.yawOffset);
    const fz = Math.cos(this.rotation.y - this.yawOffset);
    // Walkability probe: check the ground a bit ahead. Block on water/void, or a step-up too tall
    // to walk over (trees/rocks/ledges read as high ground) — the animal never climbs or swims.
    const gy = this.groundYAt(this.position.x + fx * this.lookAhead, this.position.z + fz * this.lookAhead);
    if (gy === null || gy < this.waterLevel || gy - this.position.y > this.maxStepUp) {
      this.reroute();
      this.setLocomotion(0);
      return false;
    }
    const step = Math.min(speed * deltaTime, dist);
    this.position.x += fx * step;
    this.position.z += fz * step;
    this.setLocomotion(speed);
    return false;
  }

  /** Ground height at a world XZ via a downward raycast, or null if nothing is under it. */
  private groundYAt(x: number, z: number): number | null {
    const physics = this.getPhysicsEngine();
    if (!physics) {
      return this.position.y;
    }
    const hit = physics.raycast({
      origin: new THREE.Vector3(x, this.position.y + 30, z),
      direction: new THREE.Vector3(0, -1, 0),
      maxDistance: 120,
      ignoredRootNodes: [this],
    });
    return hit ? hit.hitLocation.y : null;
  }

  /** Snap the animal onto the ground under it (keeps it from floating/clipping). */
  private applyGroundY(): void {
    const gy = this.groundYAt(this.position.x, this.position.z);
    if (gy !== null) {
      this.position.y = gy;
    }
  }

  /**
   * Watchdog: if the animal is meant to be moving (locomotion > 0) but hasn't covered ground over a
   * ~0.7s window, it's wedged against a collider. Spin a big random angle and re-target so it peels
   * off the obstacle instead of grinding in place.
   */
  private updateStuck(deltaTime: number): void {
    if (this.lastSpeed <= 0.05 || this.state === 'idle' || this.attackLock > 0) {
      this.stuckTimer = 0;
      this.stuckAnchor.x = this.position.x;
      this.stuckAnchor.z = this.position.z;
      return;
    }
    this.stuckTimer += deltaTime;
    if (this.stuckTimer < 0.7) {
      return;
    }
    const moved = Math.hypot(this.position.x - this.stuckAnchor.x, this.position.z - this.stuckAnchor.z);
    this.stuckTimer = 0;
    this.stuckAnchor.x = this.position.x;
    this.stuckAnchor.z = this.position.z;
    if (moved > 0.2) {
      return; // making progress — not stuck
    }
    // Wedged: hard turn (90-180 deg) and pick a fresh direction/target.
    this.rotation.y += (Math.random() < 0.5 ? 1 : -1) * (Math.PI * 0.5 + Math.random() * Math.PI * 0.5);
    if (this.state === 'wander') {
      this.pickWanderTarget();
    } else {
      // flee/chase: aim the target well away along the new facing so it commits to the detour.
      const fx = Math.sin(this.rotation.y - this.yawOffset);
      const fz = Math.cos(this.rotation.y - this.yawOffset);
      this.target.x = this.position.x + fx * 6;
      this.target.z = this.position.z + fz * 6;
    }
  }

  /** Blocked by water/obstacle: turn away to go around. Wandering also pauses to idle. */
  private reroute(): void {
    this.rotation.y += (Math.random() < 0.5 ? 1 : -1) * (0.6 + Math.random() * 0.8);
    if (this.state === 'wander') {
      this.pickWanderTarget();
      this.enterIdle(this.randomRange(0.4, 1.2)); // stop, look, then wander a new way
    }
    // flee/chase keep their state — the turn lets them skirt the obstacle next frame.
  }

  private facePoint(x: number, z: number, deltaTime: number): boolean {
    const desired = Math.atan2(x - this.position.x, z - this.position.z) + this.yawOffset;
    let diff = desired - this.rotation.y;
    while (diff > Math.PI) { diff -= Math.PI * 2; }
    while (diff < -Math.PI) { diff += Math.PI * 2; }
    const maxTurn = this.turnSpeed * deltaTime;
    this.rotation.y += Math.max(-maxTurn, Math.min(maxTurn, diff));
    return Math.abs(diff) < 0.2;
  }

  private pickWanderTarget(): void {
    const fromHome = Math.hypot(this.position.x - this.home.x, this.position.z - this.home.z);
    const cx = fromHome > this.homeLeash ? this.home.x : this.position.x;
    const cz = fromHome > this.homeLeash ? this.home.z : this.position.z;
    const radius = fromHome > this.homeLeash ? this.wanderRadius * 0.5 : this.wanderRadius;
    const angle = Math.random() * Math.PI * 2;
    const range = Math.random() * radius;
    this.target.x = cx + Math.cos(angle) * range;
    this.target.z = cz + Math.sin(angle) * range;
  }

  /**
   * Pick the player this animal reacts to: whoever last hit it while it is still provoked (and alive),
   * else the nearest living player. Re-evaluated once a second.
   */
  private refreshPlayer(deltaTime: number): void {
    this.playerQueryTimer -= deltaTime;
    if (this.playerQueryTimer > 0) {
      return;
    }
    this.playerQueryTimer = 1;
    const world = this.getWorld();
    if (!world) {
      this.player = null;
      return;
    }
    const isAlive = (p: ENGINE.Pawn | null): p is ENGINE.Pawn =>
      !!p && p.getWorld() === world && !(p as unknown as { isDead?: boolean }).isDead;
    if (this.provokeTimer > 0 && isAlive(this.aggroTarget)) {
      this.player = this.aggroTarget;
      return;
    }
    this.aggroTarget = null;
    let best: ENGINE.Pawn | null = null;
    let bestD = Infinity;
    for (const pc of world.getNodes(ENGINE.PlayerController)) {
      const pawn = pc.getPawn();
      if (!isAlive(pawn)) continue;
      const d = Math.hypot(pawn.position.x - this.position.x, pawn.position.z - this.position.z);
      if (d < bestD) {
        bestD = d;
        best = pawn;
      }
    }
    this.player = best;
  }

  private randomRange(min: number, max: number): number {
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    return lo + Math.random() * Math.max(0, hi - lo);
  }

  /** Find a scene node by name anywhere in the world (testing helper). */
  private findNodeByName(name: string): ENGINE.SceneNode | null {
    const roots = (this.getWorld() as unknown as { getRootNodes?: () => ENGINE.SceneNode[] })?.getRootNodes?.();
    if (!roots) {
      return null;
    }
    const stack: ENGINE.SceneNode[] = [...roots];
    while (stack.length > 0) {
      const n = stack.pop();
      if (!n) {
        continue;
      }
      if (n.name === name) {
        return n;
      }
      stack.push(...(n.children as ENGINE.SceneNode[]));
    }
    return null;
  }
}
