/**
 * SaveGame - persists the player's run (gold + inventories) to localStorage so progress survives
 * closing the game. All reads/writes are wrapped in try/catch: storage can be unavailable (private
 * window, blocked site data) and must never crash the game.
 */

import type { InventoryItem } from './Inventory.js';

const KEY = 'pth_save_v1';

export interface SaveData {
  gold: number;
  hotbar: (InventoryItem | null)[];
  backpack: (InventoryItem | null)[];
}

export function saveProgress(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable — ignore */
  }
}

export function loadProgress(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SaveData;
    if (typeof parsed?.gold !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearProgress(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
