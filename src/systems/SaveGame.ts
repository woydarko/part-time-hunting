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
  /** Backpack slot count (grown by the Hunter's Satchel); restored before the backpack loads. */
  backpackSize?: number;
  /** Merchant's Charm expiry (epoch ms), so the boost survives a reload. */
  sellBonusUntil?: number;
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
    // A hand-edited or corrupted save must not restore NaN / negative / absurd gold.
    parsed.gold = Number.isFinite(parsed.gold) ? Math.min(Math.max(0, Math.floor(parsed.gold)), 1_000_000) : 0;
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
