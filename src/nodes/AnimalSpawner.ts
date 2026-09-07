/**
 * AnimalSpawner - populates the map's animal spawn points and keeps them stocked.
 *
 * Reads every "AnimalSpawnPoint …" marker in the scene at play start, spawns one random animal at
 * each (respecting the island tier — P1 points never spawn a bear, P2 points allow any), and when an
 * animal is killed it respawns a fresh one at that point after `respawnDelay` seconds.
 */

import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

import { WildAnimal } from '../animals/WildAnimal.js';
import { SPECIES, P1_SPECIES, P2_SPECIES } from '../data/species.js';

interface SpawnPoint {
  pos: THREE.Vector3;
  island: 'P1' | 'P2';
  current: WildAnimal | null;
  respawnTimer: number; // <0 = occupied/ok, >=0 = counting down to respawn
}

@ENGINE.GameClass()
export class AnimalSpawner extends ENGINE.SceneNode {
  /** Seconds after an animal dies before its point respawns a new one. */
  @ENGINE.property()
  public respawnDelay: number = 30;

  private readonly points: SpawnPoint[] = [];

  constructor() {
    super();
    this.canEverTick = true;
  }

  public override beginPlay(): boolean {
    if (!super.beginPlay()) return false;
    const world = this.getWorld();
    if (!world) return true;

    for (const root of world.getRootNodes()) {
      const name = root.name ?? '';
      if (!name.startsWith('AnimalSpawnPoint')) continue;
      this.points.push({
        pos: root.getWorldPosition(new THREE.Vector3()),
        island: name.includes('(P2)') ? 'P2' : 'P1',
        current: null,
        respawnTimer: -1,
      });
    }
    for (const p of this.points) this.spawnAt(p);
    return true;
  }

  /** Spawn a random allowed species at a point. */
  private spawnAt(p: SpawnPoint): void {
    const world = this.getWorld();
    if (!world) return;
    const pool = p.island === 'P2' ? P2_SPECIES : P1_SPECIES; // P1 excludes the bear
    const speciesId = pool[Math.floor(Math.random() * pool.length)];
    const cfg = SPECIES[speciesId];
    if (!cfg) return;
    p.current = WildAnimal.spawnFromConfig(world, cfg, p.pos.x, p.pos.y, p.pos.z);
    p.respawnTimer = -1;
  }

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);
    for (const p of this.points) {
      if (p.current && !p.current.dead) continue; // still alive — nothing to do
      if (p.respawnTimer < 0) {
        p.respawnTimer = this.respawnDelay; // just died / empty → start the respawn countdown
        p.current = null;
      }
      p.respawnTimer -= deltaTime;
      if (p.respawnTimer <= 0) this.spawnAt(p);
    }
  }
}
