/**
 * Per-species visual + combat config for spawning WildAnimals in code (the spawner assigns these
 * onto a fresh WildAnimal before it enters the world). HP / aggression / drops come from the ANIMALS
 * economy table (applied in WildAnimal.beginPlay); this holds only the model/animation/tuning fields.
 *
 * modelUrl / animConfigUrl MUST be full string literals (no template interpolation) — the build's
 * asset scanner only bundles complete '@project/assets/...' literals.
 */

export interface SpeciesConfig {
  readonly species: string;
  readonly modelUrl: string;
  readonly animConfigUrl: string;
  readonly modelScale: number;
  readonly yawOffset: number;
  readonly footBoneNames: string;
  readonly hopDust: boolean;
  readonly hopPuffInterval?: number;
  readonly hopHeight?: number;
  readonly dustScale?: number;
  readonly attackClip?: string;
  readonly attackRange?: number;
  readonly attackCooldown?: number;
  readonly attackDuration?: number;
  readonly attackDamage?: number;
  readonly attackStrikeDelay?: number;
  readonly chaseSpeed?: number;
  readonly knockbackForce?: number;
}

export const SPECIES: Record<string, SpeciesConfig> = {
  deer: {
    species: 'deer',
    modelUrl: '@project/assets/models/rusa_anim.glb',
    animConfigUrl: '@project/assets/animations/rusa.animconfig.json',
    modelScale: 0.015,
    yawOffset: 1.5708,
    footBoneNames: 'Front_foot_L_2_end,Front_Foot_R_2_end,Hind_Foot_L_1_end,Hind_Foot_R_1_end',
    hopDust: false,
  },
  rabbit: {
    species: 'rabbit',
    modelUrl: '@project/assets/models/kelinci_anim.glb',
    animConfigUrl: '@project/assets/animations/kelinci.animconfig.json',
    modelScale: 0.013,
    yawOffset: 1.5708,
    footBoneNames: 'Front_Foot_L_end,Front_Foot_R_end,Hind_Foot_L_end,Hind_Foot_R_end',
    hopDust: true,
    hopPuffInterval: 0.55,
    hopHeight: 0.12,
  },
  boar: {
    species: 'boar',
    modelUrl: '@project/assets/models/babi_hutan_anim.glb',
    animConfigUrl: '@project/assets/animations/babi.animconfig.json',
    modelScale: 0.015,
    yawOffset: 1.5708,
    footBoneNames: 'Front_Foot_end,Front_Foot001_end,Hind_Foot_L_end,Hind_Foot_R_end',
    hopDust: false,
    attackClip: 'Armature|Boar_Attack',
    attackRange: 2,
    attackCooldown: 2,
    attackDuration: 1.5,
    attackDamage: 25,
    attackStrikeDelay: 0.9,
    chaseSpeed: 1.8,
    knockbackForce: 50,
  },
  bear: {
    species: 'bear',
    modelUrl: '@project/assets/models/beruang_anim.glb',
    animConfigUrl: '@project/assets/animations/beruang.animconfig.json',
    modelScale: 0.022,
    yawOffset: 1.5708,
    footBoneNames: 'Front_Foot_L_end,Front_Foot_R_end,Hind_Foot_L_end,Hind_Foot_R_end',
    hopDust: false,
    dustScale: 0.5,
    attackClip: 'Armature|Bear_Attack',
    attackRange: 2.5,
    attackCooldown: 2.5,
    attackDuration: 2,
    attackDamage: 40,
    attackStrikeDelay: 1.3,
    chaseSpeed: 1.7,
    knockbackForce: 100,
  },
};

/** Species allowed on each island tier. Island 1 (P1) excludes the bear; island 2 (P2) allows all. */
export const P1_SPECIES: readonly string[] = ['deer', 'rabbit', 'boar'];
export const P2_SPECIES: readonly string[] = ['deer', 'rabbit', 'boar', 'bear'];
