/**
 * StoreRewards - the bridge between the Silicon in-game store and the game.
 *
 * The store (installed into src/store by the Sandbox Studio agent) calls:
 *  - `StoreRewards.applyItem(sku)` when the player uses / receives a Temporary item. It returns
 *    false when the item cannot be applied right now (e.g. backpack full); the store should then
 *    keep the item instead of consuming it.
 *  - `StoreRewards.applyOwned(skus)` with the player's Permanent items whenever ownership loads
 *    or changes, so permanent unlocks are restored every session.
 *  - `StoreRewards.setStoreOpener(open)` once, so the game can open the store from its own key.
 *
 * Calls made before the player's pawn exists are queued and applied as soon as it does.
 */

import { STORE_ITEMS } from '../data/storeItems.js';

/** Implemented by the local player's pawn. */
export interface StoreRewardTarget {
  /** Apply one item's effect. Returns false if it cannot be applied right now. */
  grantStoreItem(sku: string): boolean;
  /** Apply (idempotently) a Permanent item the player owns. */
  applyPermanentItem(sku: string): void;
}

/** Opens the store UI; calls `onClose` when the player closes it. */
export type StoreOpener = (onClose: () => void) => void;

let target: StoreRewardTarget | null = null;
let opener: StoreOpener | null = null;
const pendingItems: string[] = [];
const ownedPermanent = new Set<string>();

export const StoreRewards = {
  /** The pawn registers itself (and null when it leaves play). */
  setTarget(next: StoreRewardTarget | null): void {
    target = next;
    if (!target) return;
    for (const sku of ownedPermanent) target.applyPermanentItem(sku);
    while (pendingItems.length > 0) {
      const sku = pendingItems.shift();
      if (sku) target.grantStoreItem(sku);
    }
  },

  /** Apply a Temporary item. Unknown SKUs are refused. */
  applyItem(sku: string): boolean {
    const def = STORE_ITEMS[sku];
    if (!def) return false;
    if (def.behaviour === 'Permanent') {
      StoreRewards.applyOwned([sku]);
      return true;
    }
    if (!target) {
      pendingItems.push(sku);
      return true;
    }
    return target.grantStoreItem(sku);
  },

  /** Restore Permanent items the player owns (call on every ownership load / change). */
  applyOwned(skus: readonly string[]): void {
    for (const sku of skus) {
      if (STORE_ITEMS[sku]?.behaviour !== 'Permanent') continue;
      ownedPermanent.add(sku);
      target?.applyPermanentItem(sku);
    }
  },

  /** Whether a Permanent item has been reported as owned this session. */
  owns(sku: string): boolean {
    return ownedPermanent.has(sku);
  },

  setStoreOpener(open: StoreOpener | null): void {
    opener = open;
  },

  /** Open the store if one is installed. Returns false when there is none. */
  openStore(onClose: () => void): boolean {
    if (!opener) return false;
    opener(onClose);
    return true;
  },
};
