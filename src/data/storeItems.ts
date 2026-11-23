/**
 * Silicon store catalog — what Part Time Hunting sells for Silicon and what each item does in play.
 *
 * The Store Manager in Sandbox Studio holds the live items (name, description, price, image, SKU).
 * This file is the game side: one entry per SKU, used to create those items and to apply them in
 * play (see StoreRewards). Keep the SKUs here and in the Store Manager identical.
 *
 * Design rules:
 *  - Convenience and progress, never a must-buy: everything here can also be earned by hunting.
 *  - Store ownership is not checked by the co-op server, so nothing here gives an edge over the
 *    other player: items help the buyer's own run (ammo, potions, gold, bag space, sell price).
 */

export type StoreCategory =
  | 'Currency' | 'Consumable' | 'Permanent Unlock' | 'Upgrade'
  | 'Cosmetic' | 'Timed Boost' | 'Access' | 'Convenience';

export interface StoreItemDef {
  /** Store Manager SKU. */
  readonly sku: string;
  readonly name: string;
  /** Player-facing description for the store card. */
  readonly description: string;
  readonly category: StoreCategory;
  /** Permanent = bought once and kept; Temporary = used up when applied. */
  readonly behaviour: 'Permanent' | 'Temporary';
  /** Suggested price in Silicon (set the real one in the Store Manager). */
  readonly suggestedPrice: number;
}

export const SKU_QUIVER = 'pth_hunters_quiver';
export const SKU_POTION_KIT = 'pth_field_potion_kit';
export const SKU_GOLD_POUCH = 'pth_gold_pouch';
export const SKU_MERCHANT_CHARM = 'pth_merchants_charm';
export const SKU_SATCHEL = 'pth_hunters_satchel';

/** Arrows granted by one Hunter's Quiver. */
export const QUIVER_ARROWS = 20;
/** Gold granted by one Gold Pouch. */
export const GOLD_POUCH_AMOUNT = 300;
/** Merchant's Charm: loot sells for this much more, for this long (real time, survives reloads). */
export const CHARM_SELL_MULT = 1.25;
export const CHARM_DURATION_MS = 30 * 60 * 1000;
/** Backpack slots with the Hunter's Satchel (base backpack is 12). */
export const SATCHEL_BACKPACK_SIZE = 16;

/**
 * Store Manager item id (core `itemId`, what the in-game store reports) -> game SKU.
 * Created in the Store Manager for game 7d357735-7787-4a97-b079-8b0dcb216a53.
 */
export const SKU_BY_ITEM_ID: Record<string, string> = {
  cmwt3g7oc00123701y7kr579w: SKU_QUIVER,
  cmwt3g96h00133701mi12hymj: SKU_POTION_KIT,
  cmwt3g9on00143701fqpykpd9: SKU_GOLD_POUCH,
  cmwt3ga6z00153701lu0cnkxw: SKU_MERCHANT_CHARM,
  cmwt3gaqr001637015v7798ks: SKU_SATCHEL,
};

export const STORE_ITEMS: Record<string, StoreItemDef> = {
  [SKU_QUIVER]: {
    sku: SKU_QUIVER,
    name: "Hunter's Quiver",
    description: `${QUIVER_ARROWS} arrows straight into your backpack. Never run dry mid-hunt.`,
    category: 'Consumable',
    behaviour: 'Temporary',
    suggestedPrice: 20,
  },
  [SKU_POTION_KIT]: {
    sku: SKU_POTION_KIT,
    name: 'Field Potion Kit',
    description: '2 Health potions, 1 Speed potion and 1 Damage potion for a tough hunt.',
    category: 'Consumable',
    behaviour: 'Temporary',
    suggestedPrice: 40,
  },
  [SKU_GOLD_POUCH]: {
    sku: SKU_GOLD_POUCH,
    name: 'Gold Pouch',
    description: `${GOLD_POUCH_AMOUNT} gold to spend at the gear shop.`,
    category: 'Currency',
    behaviour: 'Temporary',
    suggestedPrice: 50,
  },
  [SKU_MERCHANT_CHARM]: {
    sku: SKU_MERCHANT_CHARM,
    name: "Merchant's Charm",
    description: 'All loot sells for 25% more gold for 30 minutes.',
    category: 'Timed Boost',
    behaviour: 'Temporary',
    suggestedPrice: 30,
  },
  [SKU_SATCHEL]: {
    sku: SKU_SATCHEL,
    name: "Hunter's Satchel",
    description: `A bigger backpack: ${SATCHEL_BACKPACK_SIZE} slots instead of 12, for good.`,
    category: 'Permanent Unlock',
    behaviour: 'Permanent',
    suggestedPrice: 120,
  },
};
