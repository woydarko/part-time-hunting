/**
 * Sfx - tiny wrapper over GlobalAudioManager for one-shot + looping sounds. One-shots spin up an
 * independent voice each call (overlapping hits/footsteps don't cut each other off). SFX route through
 * the 'SFX' bus; music/ambience take their own bus so they mix separately (all under Master, which the
 * pause-menu volume slider controls). 2D by default; play3d places a sound at a world position.
 */

import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

import { SFX, type SfxKey } from '../data/sounds.js';

import { isHeadless } from './Net.js';

type SoundHandle = { id: string; audioUrl: string; isPositional: boolean };

function mgr(): ENGINE.GlobalAudioManager | null {
  if (isHeadless()) return null; // the co-op dedicated server has no audio
  try { return ENGINE.GlobalAudioManager.getInstance(); } catch { return null; }
}

// Big music files aren't bulk-preloaded (they stream in on demand instead of stretching the loader).
const SKIP_PRELOAD: SfxKey[] = ['menuMusic', 'gameMusic'];

export const Sfx = {
  /** Play a 2D one-shot on a bus (default SFX). */
  play(key: SfxKey, volume = 1, bus = 'SFX'): void {
    void mgr()?.playGlobalSound(SFX[key], { volume, bus });
  },

  /** Play a 3D one-shot at a world position (distance falloff). */
  play3d(key: SfxKey, position: THREE.Vector3, volume = 1, maxDistance = 40): void {
    void mgr()?.playSoundAtPosition(SFX[key], position, { volume, maxDistance, bus: 'SFX' });
  },

  /** Play one of several keys at random (footsteps, hurt grunts) as a 2D one-shot. */
  playRandom(keys: SfxKey[], volume = 1): void {
    const key = keys[Math.floor(Math.random() * keys.length)];
    if (key) this.play(key, volume);
  },

  /** Start a looping track on a bus; resolves to a handle you keep to stop it. */
  async playLoop(key: SfxKey, bus: string, volume = 1): Promise<SoundHandle | null> {
    return (await mgr()?.playGlobalSound(SFX[key], { volume, loop: true, bus })) ?? null;
  },

  /** Play a one-shot music/ambience track on a bus (non-looping). */
  playTrack(key: SfxKey, bus: string, volume = 1): void {
    void mgr()?.playGlobalSound(SFX[key], { volume, bus });
  },

  stop(handle: SoundHandle | null): void {
    if (handle) mgr()?.stopSound(handle);
  },

  /** Warm the cache for the small SFX (music streams on demand). */
  async preload(): Promise<void> {
    const m = mgr();
    if (!m) return;
    const urls = (Object.keys(SFX) as SfxKey[]).filter((k) => !SKIP_PRELOAD.includes(k)).map((k) => SFX[k]);
    await Promise.allSettled(urls.map((url) => m.loadSound(url, url)));
  },
};
