/**
 * Potion registry — consumable items the player carries and drinks. Buying one at the gear shop
 * grants a stackable consumable to the inventory; using it plays the Use_Item ("drink") animation
 * with the bottle held in the right hand, then applies the effect and removes one from the stack.
 *
 * Effects (applied at the mid-point of the drink gesture):
 *  - heal:   +30 HP
 *  - speed:  +40% move speed (one-time, non-stacking with itself)
 *  - damage: 2x weapon damage
 */

export type PotionEffect = 'heal' | 'speed' | 'damage';

export interface PotionDef {
  readonly id: PotionEffect;      // effect key doubles as the id
  readonly name: string;
  readonly icon: string;          // hotbar / backpack glyph (safe UI fallback when no 3D thumb)
  readonly modelUrl: string;      // held bottle model
  readonly price: number;
}

export const POTIONS: Record<PotionEffect, PotionDef> = {
  heal: {
    id: 'heal',
    name: 'Health Potion',
    icon: '🟢',
    modelUrl: '@project/assets/models/poison ijo.glb',
    price: 40,
  },
  speed: {
    id: 'speed',
    name: 'Speed Potion',
    icon: '🔵',
    modelUrl: '@project/assets/models/poison biru.glb',
    price: 70,
  },
  damage: {
    id: 'damage',
    name: 'Damage Potion',
    icon: '🔴',
    modelUrl: '@project/assets/models/poison merah.glb',
    price: 100,
  },
};

/**
 * Held-bottle fit in the right hand. The raw glbs have very different scales/pivots, so the bottle
 * is auto-normalized: `size` is the target height in CHARACTER-relative units (multiplied by the
 * pawn's CHARACTER_SCALE), then it's recentered in the palm. offsetPos/offsetRot fine-tune from there.
 */
export const POTION_GRIP = {
  size: 0.16,  // target hand-held height; raise/lower if the bottle looks too big/small
  offsetPos: [0, 0, 0] as [number, number, number],
  offsetRot: [0, 0, 0] as [number, number, number],
};

/** Fraction of the drink clip at which the effect fires (the "gulp" moment). */
export const POTION_EFFECT_AT = 0.55;
