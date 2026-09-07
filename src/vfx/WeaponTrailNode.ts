/**
 * WeaponTrailNode - a camera-facing ribbon that traces a source point's path (e.g. a blade
 * tip) to make a weapon slash trail. Lives in world space; sample a marker each frame while
 * active, then let the tail fade. Buffers are pre-allocated for performance.
 */

import * as THREE from 'three';

import * as ENGINE from '@gnsx/genesys.js';

const MAX_POINTS = 24;

@ENGINE.GameClass()
export class WeaponTrailNode extends ENGINE.SceneNode {
  private mesh!: THREE.Mesh;
  private geom!: THREE.BufferGeometry;
  private posAttr!: THREE.BufferAttribute;
  private colAttr!: THREE.BufferAttribute;
  private readonly points: THREE.Vector3[] = [];
  private active = false;
  private source: THREE.Object3D | null = null;
  private halfWidth = 0.2;

  // Scratch vectors (no per-frame allocation).
  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpCam = new THREE.Vector3();
  private readonly tmpToCam = new THREE.Vector3();
  private readonly tmpSide = new THREE.Vector3();

  public override initialize(options?: ENGINE.SceneNodeOptions): void {
    super.initialize(options);

    this.geom = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 2 * 3), 3);
    this.colAttr = new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 2 * 3), 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    this.geom.setAttribute('position', this.posAttr);
    this.geom.setAttribute('color', this.colAttr);

    const idx = new Uint16Array((MAX_POINTS - 1) * 6);
    for (let i = 0; i < MAX_POINTS - 1; i++) {
      const a = i * 2;
      idx.set([a, a + 1, a + 2, a + 2, a + 1, a + 3], i * 6);
    }
    this.geom.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geom.setDrawRange(0, 0);

    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });
    this.mesh = new THREE.Mesh(this.geom, mat);
    this.mesh.name = 'TrailMesh';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.add(this.mesh);

    this.canEverTick = true;
  }

  /** Start tracing `source`'s world position. */
  public begin(source: THREE.Object3D, halfWidth: number): void {
    this.source = source;
    this.halfWidth = halfWidth;
    this.points.length = 0;
    this.active = true;
  }

  /** Stop tracing; the tail fades out over the next frames. */
  public end(): void {
    this.active = false;
  }

  public override tickPostPhysics(deltaTime: number): void {
    super.tickPostPhysics(deltaTime);

    if (this.active && this.source) {
      this.source.updateWorldMatrix(true, false);
      const p = new THREE.Vector3();
      this.source.getWorldPosition(p);
      this.points.unshift(p);
      if (this.points.length > MAX_POINTS) this.points.pop();
    } else if (this.points.length > 0) {
      this.points.pop(); // drain the tail when inactive
    }

    this.rebuild();
  }

  private rebuild(): void {
    const n = this.points.length;
    if (n < 2) {
      this.geom.setDrawRange(0, 0);
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;

    const cam = (this.getWorld() as unknown as { getNode?: (t: unknown) => THREE.Camera | null } | null)
      ?.getNode?.(THREE.Camera) ?? null;
    if (cam) cam.getWorldPosition(this.tmpCam);

    const pos = this.posAttr.array as Float32Array;
    const col = this.colAttr.array as Float32Array;

    for (let i = 0; i < n; i++) {
      const cur = this.points[i];
      const prev = this.points[Math.max(i - 1, 0)];
      const next = this.points[Math.min(i + 1, n - 1)];
      // Tangent along the trail.
      this.tmpDir.copy(prev).sub(next);
      if (this.tmpDir.lengthSq() < 1e-8) this.tmpDir.set(0, 1, 0);
      this.tmpDir.normalize();
      // Face the camera: side = tangent x toCamera.
      if (cam) this.tmpToCam.copy(this.tmpCam).sub(cur).normalize();
      else this.tmpToCam.set(0, 1, 0);
      this.tmpSide.crossVectors(this.tmpDir, this.tmpToCam);
      if (this.tmpSide.lengthSq() < 1e-8) this.tmpSide.set(1, 0, 0);
      this.tmpSide.normalize();

      const fade = 1 - i / (n - 1); // newest = 1, oldest = 0
      const w = this.halfWidth * fade;
      const o = i * 6;
      pos[o] = cur.x + this.tmpSide.x * w;
      pos[o + 1] = cur.y + this.tmpSide.y * w;
      pos[o + 2] = cur.z + this.tmpSide.z * w;
      pos[o + 3] = cur.x - this.tmpSide.x * w;
      pos[o + 4] = cur.y - this.tmpSide.y * w;
      pos[o + 5] = cur.z - this.tmpSide.z * w;
      // Additive: fade the tail to black so it disappears.
      col[o] = col[o + 1] = col[o + 2] = fade;
      col[o + 3] = col[o + 4] = col[o + 5] = fade;
    }

    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.geom.setDrawRange(0, (n - 1) * 6);
    this.geom.computeBoundingSphere();
  }

  public override endPlay(): boolean {
    if (!super.endPlay()) return false;
    this.geom?.dispose();
    (this.mesh?.material as THREE.Material)?.dispose();
    return true;
  }
}
