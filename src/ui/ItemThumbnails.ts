/**
 * ItemThumbnails - renders an item's 3D model to a static PNG data URL, once per model, cached.
 *
 * Inventory grids have many slots; a live WebGL canvas per slot would blow the browser's context
 * limit. Instead one shared offscreen renderer bakes each model to an <img>-able data URL. Renders
 * are serialized (single renderer/scene) and memoized by model URL.
 */

import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

/** Rotation that brings a model's longest bounding-box axis to vertical (Y) — a consistent upright pose. */
export function standUpQuat(size: THREE.Vector3): THREE.Quaternion {
  const q = new THREE.Quaternion();
  if (size.x >= size.y && size.x >= size.z) {
    q.setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)); // X longest -> Y
  } else if (size.z >= size.y && size.z >= size.x) {
    q.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)); // Z longest -> Y
  } // else Y already longest
  return q;
}

class ItemThumbnails {
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  private readonly group = new THREE.Group();
  private readonly cache = new Map<string, Promise<string>>();
  private queue: Promise<unknown> = Promise.resolve();
  private size = 96;

  private ensure(): void {
    if (this.renderer) return;
    const canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setSize(this.size, this.size, false);
    this.camera.position.set(0, 0, 3.4);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(2, 3, 2);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x99bbff, 0.6);
    rim.position.set(-2, 1, -2);
    this.scene.add(rim);
    this.scene.add(this.group);
  }

  /** Get (rendering if needed) a PNG data URL for the model. Resolves to '' on failure. */
  public get(modelUrl: string, textureUrl?: string): Promise<string> {
    const key = `${modelUrl}|${textureUrl ?? ''}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    // Serialize renders so the shared scene isn't reused concurrently.
    const p = this.queue.then(() => this.render(modelUrl, textureUrl)).catch(() => '');
    this.queue = p.catch(() => undefined);
    this.cache.set(key, p);
    return p;
  }

  private async render(modelUrl: string, textureUrl?: string): Promise<string> {
    this.ensure();
    if (!this.renderer) return '';
    const gltf = await ENGINE.resourceManager.loadModel(ENGINE.AssetPath.fromString(modelUrl));
    if (!gltf?.scene) return '';
    const obj = gltf.scene.clone(true);
    // KayKit weapons colour comes from an external palette texture (not embedded), so the raw glb
    // renders gray. Apply the material's albedo map so the icon is coloured.
    if (textureUrl) {
      const tex = await Promise.resolve(ENGINE.resourceManager.loadTexture(ENGINE.AssetPath.fromString(textureUrl)));
      if (tex) {
        (tex as THREE.Texture).colorSpace = THREE.SRGBColorSpace;
        (tex as THREE.Texture).flipY = false; // glTF UV convention
        (tex as THREE.Texture).needsUpdate = true;
        obj.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.material = new THREE.MeshStandardMaterial({ map: tex as THREE.Texture, roughness: 0.7, metalness: 0 });
          }
        });
      }
    }
    // Center the geometry in a holder so scale/framing is consistent across wildly different models.
    obj.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return '';
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    obj.position.sub(center);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const holder = new THREE.Group();
    holder.scale.setScalar(1.5 / maxDim);
    // Stand the model's LONGEST axis vertical (so blades/bows/axes stand instead of lying flat),
    // then add a 3/4 tilt for a clean item-icon look — like the asset-browser thumbnails.
    const stand = standUpQuat(size);
    const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.32, -0.6, 0));
    holder.quaternion.copy(tilt).multiply(stand);
    holder.add(obj);
    this.group.add(holder);
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/png');
    this.group.remove(holder);
    return url;
  }
}

/** Shared singleton — one offscreen renderer for every item thumbnail. */
export const itemThumbnails = new ItemThumbnails();
