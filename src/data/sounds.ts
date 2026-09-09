/**
 * Sound registry — every SFX the game plays, keyed by role. Paths are FULL string literals (no
 * template interpolation) so the build's asset scanner bundles them. Music/ambience are intentionally
 * omitted for now. Played via the Sfx helper (one-shots through GlobalAudioManager).
 */

export const SFX = {
  // Footstep (single grass step while moving).
  footstep: '@project/assets/sounds/footstep_grass.mp3',

  // Combat.
  meleeSwing: '@project/assets/sounds/swipe.wav',
  meleeSwingAlt: '@project/assets/sounds/sword_slice.wav',
  // Dagger / 1H swings — alternate 1-2-1-2 across the combo.
  dagger1: '@project/assets/sounds/dagger_1.mp3',
  dagger2: '@project/assets/sounds/dagger_2.mp3',
  // Axe / 2H swings — axe for the regular strikes, axe360 for the spin (comboStep 3).
  axe: '@project/assets/sounds/axe.mp3',
  axe360: '@project/assets/sounds/axe_360.mp3',
  punch: '@project/assets/sounds/whoosh_1.wav',
  kick: '@project/assets/sounds/kick.wav',
  dash: '@project/assets/sounds/dash.mp3',
  bowCharge: '@project/assets/sounds/bow.mp3',
  bowFire: '@project/assets/sounds/bow_shot.mp3',
  hitAnimal: '@project/assets/sounds/crunch.wav',
  arrowHit: '@project/assets/sounds/arrow_hit.wav',
  animalHurt: '@project/assets/sounds/squelching_1.wav',
  animalDeath: '@project/assets/sounds/bone_snap.wav',
  rabbitDeath: '@project/assets/sounds/rabbit_death.mp3',
  deerDeath: '@project/assets/sounds/deer_death.mp3',
  boarDeath: '@project/assets/sounds/pig_death.mp3',
  bearDeath: '@project/assets/sounds/bear_death.mp3',
  // Per-species reaction sounds (chase / flee).
  deerRun: '@project/assets/sounds/deer_run.mp3',
  boarAggro: '@project/assets/sounds/pig_aggresive.mp3',
  bearAggro: '@project/assets/sounds/bear_aggresive.mp3',
  playerHurt1: '@project/assets/sounds/human_injured1.wav',
  playerHurt2: '@project/assets/sounds/human_injured2.wav',
  playerHurt3: '@project/assets/sounds/human_injured3.wav',
  playerHurt4: '@project/assets/sounds/human_injured4.wav',
  playerHurt5: '@project/assets/sounds/human_injured5.wav',
  playerDie: '@project/assets/sounds/human_injured5.wav',

  // Items / equip.
  equip: '@project/assets/sounds/weapon_equip.wav',
  equipMelee: '@project/assets/sounds/sword_light.wav',
  unequip: '@project/assets/sounds/weapon_unequip.wav',
  hotbarSelect: '@project/assets/sounds/item_equip.wav',
  lootPickup: '@project/assets/sounds/weapon_pick_up.wav',
  drink: '@project/assets/sounds/drinking_potion.mp3',

  // Economy.
  gold: '@project/assets/sounds/coin_collect.wav',
  sell: '@project/assets/sounds/coins_gather_medium.wav',
  buy: '@project/assets/sounds/coins_gather_small.wav',
  error: '@project/assets/sounds/synth_error.wav',

  // UI.
  uiClick: '@project/assets/sounds/click_double_off.wav',
  uiOpen: '@project/assets/sounds/pop_1.wav',
  uiClose: '@project/assets/sounds/pop_2.wav',
  uiBack: '@project/assets/sounds/cancel.wav',

  // Music / ambience (played on their own buses, not SFX).
  menuMusic: '@project/assets/sounds/golden_gleam.ogg',
  gameMusic: '@project/assets/sounds/polar_lights.ogg',
  wind: '@project/assets/sounds/wind.mp3',
} as const;

export type SfxKey = keyof typeof SFX;
