/**
 * WaterNode - a large flat water/ocean surface for islands to sit in.
 *
 * A single horizontal plane (geometry pre-rotated to lie in the XZ plane, so the node's own
 * transform stays identity and it can be placed/moved normally in the editor) with a
 * semi-transparent tinted material. Collision is disabled by default — the sea is visual only.
 *
 * Editor-tunable: `size` (metres, square), `opacity`, `waterColor`. Drag the node's Y in the
 * editor to line the surface up with the shoreline of the map.
 */

import * as THREE from 'three';

import * as ENGINE from '@gnsx/genesys.js';

@ENGINE.GameClass()
export class WaterNode extends ENGINE.MeshNode {
  /** Side length of the (square) water plane, in world units. */
  @ENGINE.property()
  public size: number = 500;

  /** Surface transparency (0 = invisible, 1 = opaque). */
  @ENGINE.property()
  public waterOpacity: number = 0.82;

  /** Surface tint as a hex string, e.g. "#2f6f8f". */
  @ENGINE.property()
  public waterColor: string = '#2f7d9a';

  private _waterMat: THREE.MeshStandardMaterial | null = null;

  constructor() {
    super();
    // The sea is visual only — no collider (character/props pass over it freely).
    this.physicsOptions = { enabled: false };
    this.castShadow = false;
    this.receiveShadow = true;
    this.rebuild();
  }

  /** (Re)build the plane geometry and material from the current properties. */
  private rebuild(): void {
    // PlaneGeometry lies in the XY plane facing +Z; rotate the GEOMETRY (not the node) so it
    // lies flat in XZ facing up, leaving the node transform free for placement.
    const geo = new THREE.PlaneGeometry(this.size, this.size, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.geometry = geo;

    const opaque = this.waterOpacity >= 1;
    if (!this._waterMat) {
      this._waterMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(this.waterColor),
        transparent: !opaque,
        opacity: this.waterOpacity,
        roughness: 0.12,
        metalness: 0.0,
        side: THREE.DoubleSide,
        depthWrite: opaque, // opaque water writes depth; transparent water skips it to avoid sorting artefacts
      });
      this.material = this._waterMat;
    } else {
      this._waterMat.color.set(this.waterColor);
      this._waterMat.opacity = this.waterOpacity;
      this._waterMat.transparent = !opaque;
      this._waterMat.depthWrite = opaque;
      this._waterMat.needsUpdate = true;
    }
  }

  public override onEditorAddToWorld(): void {
    super.onEditorAddToWorld();
    this.rebuild();
  }

  public override beginPlay(): boolean {
    if (!super.beginPlay()) return false;
    this.rebuild();
    return true;
  }

  public override onEditorPropertyChanged(
    path: string,
    value: unknown,
    result: ENGINE.EditorPropertyChangedResult,
  ): void {
    super.onEditorPropertyChanged(path, value, result);
    if (path === 'size' || path === 'waterOpacity' || path === 'waterColor') {
      this.rebuild();
    }
  }
}
