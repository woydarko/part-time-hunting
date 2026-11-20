/**
 * LootDrop - a pickup that pops out of a killed animal, drops onto the ground, and then stays PUT
 * (no rigidbody — so it can never slide, fly off, or float). It spawns right at the death point with
 * only a tiny spread, settles its base onto the terrain (via a downward raycast), and holds there.
 *
 * Pickup is pawn-driven: near the drop it shows "F to pick up <name>"; F grants it to the backpack
 * and despawns the drop.
 */

import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

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
  /** Granted to the player on pickup (the pawn subscribes to add it to the backpack). */
  public static onPickup: ((item: DropItem) => void) | null = null;

  public item: DropItem | null = null;
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
  }

  /** Spawn one drop per item, right at the death point with only a small spread. */
  public static spawnBurst(world: ENGINE.World, x: number, y: number, z: number, items: DropItem[]): void {
    for (const item of items) {
      const ang = Math.random() * Math.PI * 2;
      const r = SPREAD_MIN + Math.random() * (SPREAD - SPREAD_MIN); // ring: never bunched at the centre
      const drop = LootDrop.create({ name: `Loot_${item.id}` }) as LootDrop;
      drop.item = item;
      drop.position.set(x + Math.cos(ang) * r, y + 0.2, z + Math.sin(ang) * r);
      // NOTE: do NOT rotate the node — the visual is centered on the node using world-space offsets,
      // and a node rotation would misalign the model from the node's (pickup) position.
      world.add(drop);
    }
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

  /** Grant the item and despawn immediately (removed from the scan list first so the prompt clears). */
  public pickUp(): void {
    if (this.taken || !this.item) return;
    this.taken = true;
    const i = LootDrop.all.indexOf(this);
    if (i >= 0) LootDrop.all.splice(i, 1); // gone from the pawn's scan this frame → no lingering prompt
    LootDrop.onPickup?.(this.item);
    this.removeFromParent();
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
    if (this.life >= DESPAWN_AFTER) this.removeFromParent();
  }

  public override endPlay(): boolean {
    const i = LootDrop.all.indexOf(this);
    if (i >= 0) LootDrop.all.splice(i, 1);
    return super.endPlay();
  }
}
