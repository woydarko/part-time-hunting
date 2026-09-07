/**
 * Huntable-animal economy config — the single source of truth for species stats and their loot.
 *
 * Balance goals (from the core loop hunt -> sell -> upgrade -> hunt bigger):
 *  - HP gates which weapon tier can realistically take an animal down.
 *  - Reward roughly tracks HP + risk (aggressive animals pay more than passive ones of similar HP).
 *  - Drops are plain sellable loot (no equipId) — granted to the player's inventory on the kill.
 */

/** A sellable loot item dropped by an animal. `id` doubles as the stack key. */
export interface DropItem {
  readonly id: string;
  readonly icon: string;      // emoji fallback until the 3D thumbnail loads
  readonly name: string;
  readonly price: number;
  readonly modelUrl: string;  // per-animal loot glb (its own material colours, no texture needed)
}

/**
 * Canonical per-animal loot items + merchant sell price (gold). Tiered: bigger animal = pricier.
 * NOTE: modelUrl must be a FULL string literal (no template interpolation) — the build's asset
 * scanner only matches complete '@project/assets/...' literals, so a `${M}/x.glb` would 404.
 */
export const DROP_ITEMS: Record<string, DropItem> = {
  meat_kelinci: { id: 'meat_kelinci', icon: '🥩', name: 'Rabbit Meat', price: 10, modelUrl: '@project/assets/models/daging_kelinci.glb' },
  meat_rusa:    { id: 'meat_rusa',    icon: '🥩', name: 'Deer Meat',   price: 14, modelUrl: '@project/assets/models/daging_rusa.glb' },
  meat_babi:    { id: 'meat_babi',    icon: '🥩', name: 'Boar Meat',   price: 16, modelUrl: '@project/assets/models/daging_babi_hutan.glb' },
  meat_beruang: { id: 'meat_beruang', icon: '🥩', name: 'Bear Meat',   price: 20, modelUrl: '@project/assets/models/daging_beruang.glb' },
  pelt_kelinci: { id: 'pelt_kelinci', icon: '🐾', name: 'Rabbit Pelt', price: 18, modelUrl: '@project/assets/models/kulit_kelinci.glb' },
  pelt_rusa:    { id: 'pelt_rusa',    icon: '🐾', name: 'Deer Pelt',   price: 22, modelUrl: '@project/assets/models/kulit_rusa.glb' },
  pelt_beruang: { id: 'pelt_beruang', icon: '🐻', name: 'Bear Pelt',   price: 60, modelUrl: '@project/assets/models/kulit_beruang.glb' },
  antler_rusa:  { id: 'antler_rusa',  icon: '🦌', name: 'Antler',      price: 40, modelUrl: '@project/assets/models/tanduk_rusa.glb' },
  tusk_babi:    { id: 'tusk_babi',    icon: '🦷', name: 'Boar Tusk',   price: 60, modelUrl: '@project/assets/models/taring_babi_hutan.glb' },
  bone_beruang: { id: 'bone_beruang', icon: '🦴', name: 'Bear Bone',   price: 16, modelUrl: '@project/assets/models/tulang_beruang.glb' },
};

export interface AnimalDef {
  readonly id: string;
  readonly label: string;
  readonly hp: number;
  /** true = chase + attack when hit; false = flee when hit. */
  readonly aggressive: boolean;
  /** Loot ids granted on the kill (repeat an id to drop more than one). */
  readonly drops: readonly string[];
}

/**
 * Species table. Total loot value per kill (for reference):
 *   rabbit 32g · deer 72g · boar 90g · bear 130g.
 */
export const ANIMALS: Record<string, AnimalDef> = {
  // Tier 1 — quick but not a one-tap; a couple of hits or one good arrow. Starter income.
  rabbit: { id: 'rabbit', label: 'Rabbit',    hp: 30,  aggressive: false, drops: ['meat_kelinci', 'pelt_kelinci'] },
  // Tier 2 — the reliable mid-game earner (the valuable antler). Flees fast when hit → bring a bow.
  deer:   { id: 'deer',   label: 'Deer',      hp: 100, aggressive: false, drops: ['antler_rusa', 'meat_rusa', 'pelt_rusa'] },
  // Tier 3 — aggressive: it charges and hurts you. Ranged / heavy melee strongly preferred.
  boar:   { id: 'boar',   label: 'Wild Boar', hp: 180, aggressive: true,  drops: ['meat_babi', 'meat_babi', 'tusk_babi'] },
  // Tier 4 — endgame. Very tanky + very aggressive; needs top gear (axe / crossbow), pays the most.
  bear:   { id: 'bear',   label: 'Bear',      hp: 320, aggressive: true,  drops: ['meat_beruang', 'meat_beruang', 'bone_beruang', 'pelt_beruang'] },
};

/** Resolve a species' drop ids to concrete loot items (unknown ids skipped). */
export function resolveDrops(speciesId: string): DropItem[] {
  const def = ANIMALS[speciesId];
  if (!def) return [];
  return def.drops.map((id) => DROP_ITEMS[id]).filter((d): d is DropItem => !!d);
}
