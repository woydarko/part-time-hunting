/**
 * Melee weapon registry. Each entry describes how a weapon is instantiated and seated in the
 * pawn's right-hand socket, plus its slash-trail width and whether it drives the one-hand or
 * two-hand attack animation set.
 *
 * Tuning (size / grip position / rotation): the socket already bakes CHARACTER_SCALE, so `scale`
 * here is the weapon's LOCAL scale inside the socket and `offsetPos`/`offsetRot` are LOCAL to the
 * socket (metres / degrees). Prefab weapons (dagger) carry their own scale in the prefab, so their
 * `scale` here is 1. Nudge these numbers to fine-tune the grip — they're the only knobs needed.
 */

export interface WeaponDef {
  readonly id: string;
  readonly icon: string;      // hotbar glyph
  readonly name: string;      // hotbar tooltip / label
  /** 'prefab' loads a .prefab.json (dagger); 'model' loads a raw glTF/glb (KayKit weapons). */
  readonly source: 'prefab' | 'model';
  readonly url: string;
  /** Optional material override; omit to use the model's own embedded material. */
  readonly material?: string;
  /** True = uses the 2H attack animation set (axe); false = 1H set (dagger, blade). */
  readonly twoHand: boolean;
  /** True = ranged weapon (bow/crossbow): fires a projectile with the shoot animation, no slash trail. */
  readonly ranged?: boolean;
  /** Which hand socket holds it. Default 'right'; a bow goes 'left' (the right hand draws the string). */
  readonly socket?: 'left' | 'right';
  /** Local scale inside the hand socket (1 for prefabs that carry their own scale). */
  readonly scale: number;
  /** Local grip offset inside the socket (metres). */
  readonly offsetPos: readonly [number, number, number];
  /** Local grip rotation inside the socket (degrees, XYZ euler). */
  readonly offsetRot: readonly [number, number, number];
  /** Trail half-width in full-size units (the pawn multiplies by CHARACTER_SCALE). */
  readonly trailWidth: number;
  /** Damage per hit (melee swing, or arrow impact for ranged). Multiplied by the pawn's damage buff. */
  readonly damage: number;
  /** Gear-shop buy price (gold). 0 = free starter. */
  readonly price: number;
  /** Ranged-only projectile/charge tuning (bow, crossbow). Speeds/gravity are pre-CHARACTER_SCALE. */
  readonly rangedStats?: RangedStats;
  /** glb used to render the UI thumbnail icon (prefabs point at their raw glb here). */
  readonly iconUrl: string;
  /** Albedo texture (the material's mapPath) applied to the thumbnail so it isn't rendered gray. */
  readonly iconTextureUrl?: string;
}

/** Per-weapon ranged tuning. Charge (built while aiming) scales projectile speed + accuracy. */
export interface RangedStats {
  /** Seconds of aiming to reach full charge. */
  readonly chargeTime: number;
  /** Projectile speed at zero charge → full charge (m/s, pre-scale). Higher = flatter/faster. */
  readonly minSpeed: number;
  readonly maxSpeed: number;
  /** Downward accel (m/s^2, pre-scale). Lower = flatter arc. */
  readonly gravity: number;
  /** Despawn distance (m, pre-scale) — effective range. */
  readonly maxDistance: number;
  /** Seconds between shots (reload / fire-rate). */
  readonly fireCooldown: number;
  /** Max aim spread (degrees) at zero charge; 0 at full charge (accuracy). */
  readonly maxSpreadDeg: number;
}

/** Bare-hands damage per punch/kick (no weapon equipped) — deliberately weak, an emergency option. */
export const BAREHAND_DAMAGE = 8;

export const WEAPONS: Record<string, WeaponDef> = {
  // Reference weapon — prefab keeps its own 0.01 scale + M_Dagger material. Blade points +Z.
  dagger: {
    id: 'dagger',
    icon: '🗡️',
    name: 'Dagger',
    source: 'prefab',
    url: '@project/assets/models/Dagger.prefab.json',
    material: '@project/assets/materials/M_Dagger.material.json',
    twoHand: false,
    scale: 1,
    offsetPos: [0, 0, 0],
    offsetRot: [0, 0, 0],
    trailWidth: 0.18,
    damage: 20, // fast, cheap starter; weak per hit
    price: 0,
    iconUrl: '@project/assets/models/dagger.glb',
    iconTextureUrl: '@project/assets/textures/rogue_texture.png',
  },
  // KayKit skeleton sword (fbx-imported glb; the build pipeline hangs on the raw .gltf so we use the
  // glb). The fbx export had flipped the V texcoord, making the blade sample the CYAN block of the
  // palette atlas — we flipped the UVs back in the .glb (scratchpad/flip_uv.py) so it samples the
  // grey steel block. glb bakes a 100x node scale, so `scale` is ~0.01; texture via M_Skeleton.
  blade: {
    id: 'blade',
    icon: '⚔️',
    name: 'Blade',
    source: 'model',
    url: '@project/assets/models/Skeleton_Blade.glb',
    material: '@project/assets/materials/M_Skeleton.material.json',
    twoHand: false,
    scale: 0.013,
    offsetPos: [0, 0, 0],
    offsetRot: [0, 0, 0],
    trailWidth: 0.17,
    damage: 35, // solid 1H mid-tier
    price: 200,
    iconUrl: '@project/assets/models/Skeleton_Blade.glb',
    iconTextureUrl: '@project/assets/textures/skeleton_texture.png',
  },
  // KayKit skeleton axe (fbx glb; UVs flipped back — see the blade note above). 2H chop set.
  axe: {
    id: 'axe',
    icon: '🪓',
    name: 'Axe',
    source: 'model',
    url: '@project/assets/models/Skeleton_Axe.glb',
    material: '@project/assets/materials/M_Skeleton.material.json',
    twoHand: true,
    scale: 0.014,
    offsetPos: [0, 0, 0],
    offsetRot: [0, 0, 0],
    trailWidth: 0.24,
    damage: 55, // slow 2H chopper; biggest melee hit (bear-capable)
    price: 350,
    iconUrl: '@project/assets/models/Skeleton_Axe.glb',
    iconTextureUrl: '@project/assets/textures/skeleton_texture.png',
  },
  // KayKit Adventurers bow (converted gltf->glb, clean scale + correct UVs). Ranged: fires arrows.
  // Uses ranger_texture. Held in the left-hand socket; model long axis (limb-to-limb) is +Z, so
  // roll +90 about X to stand the limbs VERTICAL in the fist (like the KayKit ranger reference).
  // If screenshots show the belly facing the wrong way, flip to [-90, 0, 0].
  bow: {
    id: 'bow',
    icon: '🏹',
    name: 'Bow',
    source: 'model',
    url: '@project/assets/models/Bow.glb',
    material: '@project/assets/materials/M_Ranger.material.json',
    twoHand: true,
    ranged: true,
    socket: 'left',
    scale: 1.2,
    offsetPos: [0, 0, 0],
    offsetRot: [90, 180, 0],
    trailWidth: 0,
    damage: 30, // safe ranged workhorse; cheap first upgrade
    price: 120,
    iconUrl: '@project/assets/models/Bow.glb',
    iconTextureUrl: '@project/assets/textures/ranger_texture.png',
    // Nimble: quick draw + fast reload, moderate speed/range. Needs a full draw to be accurate.
    rangedStats: { chargeTime: 1.0, minSpeed: 22, maxSpeed: 46, gravity: 8, maxDistance: 120, fireCooldown: 0.35, maxSpreadDeg: 8 },
  },
  // KayKit Adventurers 1-handed crossbow (rogue_texture, already in project). Ranged.
  crossbow: {
    id: 'crossbow',
    icon: '🎯',
    name: 'Crossbow',
    source: 'model',
    url: '@project/assets/models/Crossbow.glb',
    material: '@project/assets/materials/M_Rogue.material.json',
    twoHand: false,
    ranged: true,
    scale: 1,
    offsetPos: [-0.27, -0.04, 0],
    offsetRot: [-90, 85, 90],
    trailWidth: 0,
    damage: 50, // best ranged; endgame bear tool
    price: 450,
    iconUrl: '@project/assets/models/Crossbow.glb',
    iconTextureUrl: '@project/assets/textures/rogue_texture.png',
    // Heavy: slow crank + slow reload, but very fast/flat bolt, long range, tighter base accuracy.
    rangedStats: { chargeTime: 1.5, minSpeed: 38, maxSpeed: 72, gravity: 6, maxDistance: 175, fireCooldown: 0.95, maxSpreadDeg: 4 },
  },
};

/** Arrow projectile shared by all ranged weapons. */
export const ARROW = {
  url: '@project/assets/models/Arrow.glb',
  material: '@project/assets/materials/M_Ranger.material.json',
  scale: 1.0,       // local scale of the arrow model in the world
  speed: 40,        // launch speed m/s (scaled by the pawn's CHARACTER_SCALE at spawn) — fast = flatter
  gravity: 8,       // downward accel m/s^2 (scaled) — lower = flatter arc, closer to the crosshair
  maxDistance: 130, // despawn after this many metres of travel (longer range)
  damage: 30,       // fallback only — the firing weapon's own `damage` is used per shot (bow 30 / crossbow 50)
};

/** Arrow ammo item — bought in the gear shop, consumed per shot, stacks (max 8) in the backpack. */
export const ARROW_ITEM = {
  id: 'arrow',
  icon: '➶',
  name: 'Arrow',
  price: 3, // gold per arrow (bought one at a time)
  modelUrl: '@project/assets/models/Arrow.glb',
  textureUrl: '@project/assets/textures/ranger_texture.png',
};

/** Potion prices (gold). Effects: heal = +30 HP, speed = +40% move, damage = 2x damage. */
export const POTION_PRICES: Record<'heal' | 'speed' | 'damage', number> = {
  heal: 40,
  speed: 70,
  damage: 100,
};

/** Ordered ids for seeding the hotbar (slots 0..N). */
export const WEAPON_ORDER: readonly string[] = ['dagger', 'axe', 'blade'];

