/**
 * Potion3DPreview - a tiny self-contained 3D viewer for a potion bottle, shown on the gear-shop
 * card. One reusable canvas + WebGL renderer: call show(url) to (re)load a model and spin it,
 * hide() to pause, dispose() to release the GL context. Auto-fits the model to the view.
 *
 * Standalone from the game renderer on purpose — the shop is a DOM overlay, so this owns its own
 * minimal scene/camera/light and a requestAnimationFrame spin loop.
 */

import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import { standUpQuat } from './ItemThumbnails.js';

export class Potion3DPreview {
  public readonly element: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly group = new THREE.Group();
  private raf = 0;
  private running = false;
  private token = 0; // guards against a slow load resolving after the shown potion changed

  constructor(size = 150) {
    this.element = document.createElement('canvas');
    Object.assign(this.element.style, { width: `${size}px`, height: `${size}px`, display: 'block' } as CSSStyleDeclaration);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.element, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(size, size, false);

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    this.camera.position.set(0, 0, 3.8); // pulled back so the bottle sits inside the frame with margin

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(2, 3, 2);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x99bbff, 0.6);
    rim.position.set(-2, 1, -2);
    this.scene.add(rim);
    this.scene.add(this.group);
  }

  /** Load a model (by @project/@engine asset path) and start spinning it. Optional albedo texture. */
  public show(modelUrl: string, textureUrl?: string): void {
    const myToken = ++this.token;
    this.clearGroup();
    ENGINE.resourceManager.loadModel(ENGINE.AssetPath.fromString(modelUrl)).then(async (gltf) => {
      if (!gltf?.scene || myToken !== this.token) return; // superseded or failed
      const obj = gltf.scene.clone(true);
      // Colour KayKit weapons with their palette texture (embedded glb is gray).
      if (textureUrl) {
        const tex = await Promise.resolve(ENGINE.resourceManager.loadTexture(ENGINE.AssetPath.fromString(textureUrl)));
        if (tex && myToken === this.token) {
          (tex as THREE.Texture).colorSpace = THREE.SRGBColorSpace;
          (tex as THREE.Texture).flipY = false;
          (tex as THREE.Texture).needsUpdate = true;
          obj.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (mesh.isMesh) mesh.material = new THREE.MeshStandardMaterial({ map: tex as THREE.Texture, roughness: 0.7, metalness: 0 });
          });
        }
      }
      // Center the geometry inside a holder so scaling + spin pivot on the model's true center
      // (some bottle glbs bake an off-origin pivot — scaling the model directly makes it orbit).
      obj.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(obj);
      if (box.isEmpty()) return;
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      obj.position.sub(center);          // geometry now centered at the holder's origin
      const holder = new THREE.Group();
      holder.scale.setScalar(1.45 / maxDim); // fill with margin so it isn't cropped at the edges
      holder.quaternion.copy(standUpQuat(size)); // stand the longest axis up so it spins upright
      holder.add(obj);
      this.group.add(holder);
    }).catch(() => { /* keep the emoji fallback if the model can't load */ });
    this.start();
  }

  private clearGroup(): void {
    for (let i = this.group.children.length - 1; i >= 0; i--) this.group.remove(this.group.children[i]);
    this.group.rotation.set(0, 0, 0);
  }

  private start(): void {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.group.rotation.y += 0.02;
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Pause the spin loop (keeps the GL context; call show() to resume with a model). */
  public hide(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  public dispose(): void {
    this.hide();
    this.clearGroup();
    this.renderer.dispose();
  }
}
