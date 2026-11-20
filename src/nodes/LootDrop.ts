/**
 * LootDrop - a pickup that pops out of a killed animal, drops onto the ground, and then stays PUT
 * (no rigidbody — so it can never slide, fly off, or float). It spawns right at the death point with
 * only a tiny spread, settles its base onto the terrain (via a downward raycast), and holds there.
 *
 * Pickup is pawn-driven: near the drop it shows "F to pick up <name>"; F asks the server, which
 * grants it to that player's backpack and despawns the drop for everyone.
 *
 * Co-op: drops are spawned by the server through HuntSpawner, so every player sees the same drops
 * and each one can be taken exactly once. Solo play runs the same path locally.
 */

import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

import { isAuthority } from '../systems/Net.js';

import { HuntSpawner } from './HuntSpawner.js';

import type { DropItem } from '../data/animals.js';

const VISUAL_SIZE = 0.35; // loot model normalized size
const SPREAD = 1.3;       // max horizontal spread around the death point
const SPREAD_MIN = 0.5;   // min distance from the death point (keeps drops from stacking in the centre)
const POP_HEIGHT = 0.4;   // how high it pops before dropping
const POP_TIME = 0.4;     // seconds of the pop/drop settle
const DESPAWN_AFTER = 120; // seconds before uncollected loot clears

@ENGINE.GameClass()
export class LootDrop extends ENGINE.SceneNode {
  /** All live drops — the pawn scans these for the nearest pickup. */
  public static readonly all: LootDrop[] = [];
  /** Next server-assigned loot id (server / solo only). */
  private static nextLootId = 1;

  public item: DropItem | null = null;
  /** Server-assigned id; a player's pickup request names the drop by it. */
  public lootId = 0;
  private visual: ENGINE.ModelMeshNode | null = null;
  private restY = 0;
  private popT = 0;
  private popping = false;
  private placed = false;
  private taken = false;
  private life = 0;

  constructor() {
    super();
    this.canEverTick = true;
    // Its own replicated entity, spawned by HuntSpawner on the server and mirrored on clients.
    this.isRoot = true;
    this.replicated = true;
  }

  /** Build (not add) a drop; HuntSpawner adds it to the world on the server and on every client. */
  public static fromItem(lootId: number, item: DropItem, x: number, y: number, z: number): LootDrop {
    const drop = LootDrop.create({ name: `Loot_${lootId}` }) as LootDrop;
    drop.lootId = lootId;
    drop.item = item;
    // NOTE: do NOT rotate the node — the visual is centered on the node using world-space offsets,
    // and a node rotation would misalign the model from the node's (pickup) position.
    drop.position.set(x, y, z);
    return drop;
  }

  /**
   * Spawn one drop per item, right at the death point with only a small spread. Server / solo only:
   * the server picks the random spread so every player sees the drops in the same places.
   */
  public static spawnBurst(world: ENGINE.World, x: number, y: number, z: number, items: DropItem[]): void {
    if (!isAuthority()) return;
    const spawner = HuntSpawner.find(world);
    if (!spawner) return;
    for (const item of items) {
      const ang = Math.random() * Math.PI * 2;
      const r = SPREAD_MIN + Math.random() * (SPREAD - SPREAD_MIN); // ring: never bunched at the centre
      void spawner.spawnLoot(LootDrop.nextLootId++, item.id, x + Math.cos(ang) * r, y + 0.2, z + Math.sin(ang) * r);
    }
  }

  /** The live drop with this id, or null (already taken or despawned). */
  public static findById(lootId: number): LootDrop | null {
    return LootDrop.all.find((d) => d.lootId === lootId && !d.taken) ?? null;
  }

  public override beginPlay(): boolean {
    if (!super.beginPlay()) return false;
    LootDrop.all.push(this);
    if (!this.item) return true;
    const v = ENGINE.ModelMeshNode.create({
      name: 'LootMesh',
      modelUrl: this.item.modelUrl,
      physicsOptions: { enabled: false }, // no physics — it's placed, not simulated
      castShadow: true,
    });
    this.add(v);
    this.visual = v;
    const onLoaded = () => this.place(v);
    if (v.isModelLoaded?.()) onLoaded();
    else v.onMeshLoaded?.add(() => onLoaded());
    return true;
  }

  /** Normalize size, seat the model's base on the terrain, and start the pop-drop settle. */
  private place(v: ENGINE.ModelMeshNode): void {
    if (this.placed) return;
    this.placed = true;
    v.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(v);
    if (!box.isEmpty()) {
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const s = VISUAL_SIZE / maxDim;
      v.scale.setScalar(s);
      // Center the model horizontally on the node, and lift it so its lowest point sits at the node
      // origin (which we then rest on the ground). Offsets are the geometry's position RELATIVE to
      // the node, taken at scale 1 and then scaled.
      const nodePos = this.getWorldPosition(new THREE.Vector3());
      v.position.set(
        -(center.x - nodePos.x) * s,
        -(box.min.y - nodePos.y) * s,
        -(center.z - nodePos.z) * s,
      );
    }
    this.addOutline(v); // thin white highlight so drops are easy to spot on the ground
    // Ground height under the drop → the node rests there; the model base sits on it.
    const groundY = this.groundYAt(this.position.x, this.position.z);
    this.restY = groundY ?? this.position.y;
    this.position.y = this.restY + POP_HEIGHT;
    this.popT = 0;
    this.popping = true;
  }

  /** Add a thin white inverted-hull outline to every mesh (a subtle highlight rim). */
  private addOutline(root: THREE.Object3D): void {
    // toneMapped:false keeps it pure bright white regardless of the scene's tone mapping/exposure.
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide, toneMapped: false, fog: false });
    const shells: { mesh: THREE.Mesh; parent: THREE.Object3D }[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry) {
        const shell = new THREE.Mesh(m.geometry, mat);
        shell.scale.setScalar(1.06); // slightly larger → only the rim shows
        shells.push({ mesh: shell, parent: m });
      }
    });
    for (const s of shells) s.parent.add(s.mesh); // add after the traverse so we don't re-visit shells
  }

  /** Terrain height under (x,z) via a downward raycast, or null. */
  private groundYAt(x: number, z: number): number | null {
    const physics = this.getPhysicsEngine();
    if (!physics) return null;
    const hit = physics.raycast({
      origin: new THREE.Vector3(x, this.position.y + 5, z),
      direction: new THREE.Vector3(0, -1, 0),
      maxDistance: 60,
    });
    return hit ? hit.hitLocation.y : null;
  }

  public getPickupPosition(out: THREE.Vector3): THREE.Vector3 {
    return this.getWorldPosition(out);
  }

  /**
   * Server / solo: mark taken and despawn for everyone. Returns the item to grant, or null when the
   * drop was already taken (two players pressing F on the same drop: only the first one gets it).
   */
  public take(): DropItem | null {
    if (this.taken || !this.item || !isAuthority()) return null;
    this.taken = true;
    const i = LootDrop.all.indexOf(this);
    if (i >= 0) LootDrop.all.splice(i, 1); // gone from the pawn's scan this frame → no lingering prompt
    this.despawn();
    return this.item;
  }

  /** Remove this drop on the server and, through the spawner, on every client. */
  private despawn(): void {
    const spawner = HuntSpawner.find(this.getWorld());
    if (!spawner?.despawnInstance(this)) this.removeFromParent();
  }

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);
    if (this.taken) return;
    // Late-loading safety: if the model finished loading after beginPlay, place it now.
    if (!this.placed && this.visual?.isModelLoaded?.()) this.place(this.visual);
    // Pop-drop settle, then hold forever (no physics — it never moves again).
    if (this.popping) {
      this.popT += deltaTime;
      const t = Math.min(1, this.popT / POP_TIME);
      const e = 1 - (1 - t) * (1 - t); // easeOut
      this.position.y = this.restY + POP_HEIGHT * (1 - e);
      if (t >= 1) {
        this.position.y = this.restY;
        this.popping = false;
      }
    }
    this.life += deltaTime;
    // Uncollected loot clears after a while; the server decides so it vanishes for everyone at once.
    if (this.life >= DESPAWN_AFTER && isAuthority()) {
      this.taken = true;
      this.despawn();
    }
  }

  public override endPlay(): boolean {
    const i = LootDrop.all.indexOf(this);
    if (i >= 0) LootDrop.all.splice(i, 1);
    return super.endPlay();
  }
}
