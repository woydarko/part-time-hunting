/**
 * Inline VFX definitions for foot dust.
 *  - RUN_DUST : loops while moving (soft tan puffs kicked up at the feet).
 *  - BURST_DUST : one-shot radial puff for jump takeoff / landing.
 *  - DASH_DUST : one-shot straight streak trailing the dash direction (stretched billboards).
 * Particle counts are kept low for performance; nodes are created once and reused.
 */

const DUST_COLORS = ['#c9b48f', '#b8a583', '#d8c9a8'];

// 3D puffs: each particle is a small sphere mesh (volumetric look), not a flat billboard.
const DUST_PARTICLES = {
  nbParticles: 200,
  intensity: 1,
  renderMode: 'mesh' as const,
  geometryPath: '@engine/assets/models/SM_ChamferCube.glb', // faceted octagon-ish blob, not a perfect ball
  blendingMode: 'normal' as const,
  fadeAlpha: [0.15, 0.6] as [number, number],
  fadeSize: [0.0, 0.7] as [number, number],
  gravity: [0, 0.25, 0] as [number, number, number],
};

// Random tumble so the 3D puffs don't look rigid.
const DUST_ROT = {
  startRotationMin: [0, 0, 0] as [number, number, number],
  startRotationMax: [6.28, 6.28, 6.28] as [number, number, number],
  rotationSpeedMin: [-2, -2, -2] as [number, number, number],
  rotationSpeedMax: [2, 2, 2] as [number, number, number],
};

/** Continuous dust while walking/running. */
export const RUN_DUST = {
  version: 1 as const,
  name: 'FootRunDust',
  particles: [DUST_PARTICLES],
  emitters: [
    {
      particlesIndex: 0,
      loop: true,
      spawnMode: 'time' as const,
      duration: 1,
      nbParticles: 22,
      particlesLifetime: [0.3, 0.6] as [number, number],
      startPositionMin: [-0.15, 0, -0.15] as [number, number, number],
      startPositionMax: [0.15, 0.06, 0.15] as [number, number, number],
      directionMin: [-0.4, 0.5, -0.4] as [number, number, number],
      directionMax: [0.4, 1, 0.4] as [number, number, number],
      size: [0.0007, 0.0016] as [number, number], // model is 100u, so ~7-16cm bits
      speed: [0.3, 0.8] as [number, number],
      colorStart: DUST_COLORS,
      colorEnd: DUST_COLORS,
      ...DUST_ROT,
    },
  ],
};

/** One-shot radial puff for jump takeoff / landing. */
export const BURST_DUST = {
  version: 1 as const,
  name: 'FootBurstDust',
  particles: [DUST_PARTICLES],
  emitters: [
    {
      particlesIndex: 0,
      loop: false,
      spawnMode: 'burst' as const,
      duration: 0.2,
      nbParticles: 24,
      particlesLifetime: [0.35, 0.7] as [number, number],
      startPositionMin: [-0.2, 0, -0.2] as [number, number, number],
      startPositionMax: [0.2, 0.05, 0.2] as [number, number, number],
      directionMin: [-0.8, 0.4, -0.8] as [number, number, number],
      directionMax: [0.8, 0.9, 0.8] as [number, number, number],
      size: [0.0006, 0.0014] as [number, number], // ~6-14cm bits (model is 100u)
      speed: [0.8, 1.8] as [number, number],
      colorStart: DUST_COLORS,
      colorEnd: DUST_COLORS,
      ...DUST_ROT,
    },
  ],
};

/**
 * One-shot straight streak for dash. Particles are stretched billboards fired backward
 * (local +Z) so they read as a straight line along the dash path. The node is rotated
 * to the dash direction at trigger time.
 */
// Standalone (NOT spread from the mesh dust) so it stays a flat stretched billboard streak.
const DASH_STREAK_PARTICLES = {
  nbParticles: 60,
  intensity: 1,
  appearance: 'circular' as const,
  renderMode: 'stretchBillboard' as const,
  stretchScale: 4.5,
  blendingMode: 'normal' as const,
  fadeAlpha: [0.15, 0.6] as [number, number],
  fadeSize: [0.0, 0.7] as [number, number],
  gravity: [0, 0.1, 0] as [number, number, number],
};

export const DASH_DUST = {
  version: 1 as const,
  name: 'DashStreakDust',
  particles: [DASH_STREAK_PARTICLES],
  emitters: [
    {
      particlesIndex: 0,
      loop: false,
      spawnMode: 'burst' as const,
      duration: 0.15,
      nbParticles: 16,
      particlesLifetime: [0.45, 0.9] as [number, number],
      startPositionMin: [-0.12, 0, -0.1] as [number, number, number],
      startPositionMax: [0.12, 0.1, 0.1] as [number, number, number],
      // Fire backward (+Z local) with tiny spread -> straight trail behind the dash.
      directionMin: [-0.08, 0.05, 0.7] as [number, number, number],
      directionMax: [0.08, 0.25, 1] as [number, number, number],
      size: [0.2, 0.5] as [number, number],
      speed: [3.5, 6.0] as [number, number],
      colorStart: DUST_COLORS,
      colorEnd: DUST_COLORS,
      useLocalDirection: true,
    },
  ],
};
