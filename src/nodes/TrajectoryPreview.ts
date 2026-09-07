/**
 * TrajectoryPreview - a thin grey poly-line tracing the predicted ballistic arc of an arrow. Driven
 * by the pawn while aiming a ranged weapon; the pawn integrates the same gravity/velocity the arrow
 * will use, so the preview matches the shot.
 *
 * Spawned in code and added to the world once. `update()` rewrites the line each frame; `setShown()`
 * toggles visibility. Developer-authored visuals only.
 */

import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

const MAX_POINTS = 48;

@ENGINE.GameClass()
export class TrajectoryPreview extends ENGINE.SceneNode {
  private readonly geom = new THREE.BufferGeometry();
  private readonly positions = new Float32Array(MAX_POINTS * 3);
  private line!: THREE.Line;
  private built = false;

  private build(): void {
    if (this.built) return;
    this.geom.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geom.setDrawRange(0, 0);
    const lineMat = new THREE.LineBasicMaterial({
      color: 0xff3b30, // red
      transparent: true,
      opacity: 0.7,
      depthTest: false,
    });
    this.line = new THREE.Line(this.geom, lineMat);
    this.line.name = 'TrajectoryLine';
    this.line.frustumCulled = false;
    this.line.renderOrder = 999;
    this.add(this.line);

    this.visible = false;
    this.built = true;
  }

  public override beginPlay(): boolean {
    if (!super.beginPlay()) return false;
    this.build();
    return true;
  }

  /** Redraw the arc from world-space samples along the path. Called every frame while aiming. */
  public update(points: readonly THREE.Vector3[]): void {
    if (!this.built) this.build();
    const n = Math.min(points.length, MAX_POINTS);
    for (let i = 0; i < n; i++) {
      this.positions[i * 3] = points[i].x;
      this.positions[i * 3 + 1] = points[i].y;
      this.positions[i * 3 + 2] = points[i].z;
    }
    this.geom.setDrawRange(0, n);
    (this.geom.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.geom.computeBoundingSphere();
  }

  public setShown(on: boolean): void {
    if (!this.built) this.build();
    this.visible = on;
  }
}
