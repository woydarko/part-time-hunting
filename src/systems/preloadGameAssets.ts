/**
 * preloadGameAssets - warms every asset the moment-to-moment game needs BEFORE the player is handed
 * control, so nothing pops in: the character + weapon/potion/loot/animal models into the resource
 * cache, and the backpack/shop item thumbnails (baked offscreen). Called from the pawn's beginPlay
 * behind the loading screen; resolves once everything settled (failures are swallowed so one bad
 * asset can't wedge the loader).
 */

import * as ENGINE from '@gnsx/genesys.js';

import { itemThumbnails } from '../ui/ItemThumbnails.js';
import { SPECIES } from '../data/species.js';
import { WEAPONS, ARROW_ITEM } from '../data/weapons.js';
import { POTIONS } from '../data/potions.js';
import { DROP_ITEMS } from '../data/animals.js';
import { Sfx } from './Sfx.js';

const BARBARIAN_MODEL_URL = '@project/assets/models/Barbarian.glb';
// The whole environment (terrain + trees + rocks) lives in the map glb — preload it so the world is
// fully built before control is handed over (no map pop-in).
const MAP_MODEL_URL = '@project/assets/models/map revisi.glb';

async function loadModel(url: string): Promise<void> {
  try { await ENGINE.resourceManager.loadModel(ENGINE.AssetPath.fromString(url)); } catch { /* ignore */ }
}
async function loadTexture(url: string): Promise<void> {
  try { await ENGINE.resourceManager.loadTexture(ENGINE.AssetPath.fromString(url)); } catch { /* ignore */ }
}
async function bakeThumb(modelUrl: string, textureUrl?: string): Promise<void> {
  try { await itemThumbnails.get(modelUrl, textureUrl); } catch { /* ignore */ }
}

/** Preload all gameplay assets. Resolves when done; never rejects. */
export async function preloadGameAssets(): Promise<void> {
  const tasks: Promise<void>[] = [];

  // Environment + character + animals (models into the resource cache so nothing pops in / streams).
  tasks.push(loadModel(MAP_MODEL_URL));
  tasks.push(loadModel(BARBARIAN_MODEL_URL));
  for (const s of Object.values(SPECIES)) tasks.push(loadModel(s.modelUrl));

  // Weapons: model into cache + baked backpack/shop icon.
  for (const w of Object.values(WEAPONS)) {
    tasks.push(loadModel(w.iconUrl));
    if (w.iconTextureUrl) tasks.push(loadTexture(w.iconTextureUrl));
    tasks.push(bakeThumb(w.iconUrl, w.iconTextureUrl));
  }

  // Potions.
  for (const p of Object.values(POTIONS)) {
    tasks.push(loadModel(p.modelUrl));
    tasks.push(bakeThumb(p.modelUrl));
  }

  // Arrows.
  tasks.push(loadModel(ARROW_ITEM.modelUrl));
  tasks.push(loadTexture(ARROW_ITEM.textureUrl));
  tasks.push(bakeThumb(ARROW_ITEM.modelUrl, ARROW_ITEM.textureUrl));

  // Loot drops (models + backpack/shop icons).
  for (const d of Object.values(DROP_ITEMS)) {
    tasks.push(loadModel(d.modelUrl));
    tasks.push(bakeThumb(d.modelUrl));
  }

  tasks.push(Sfx.preload());

  await Promise.allSettled(tasks);
}
