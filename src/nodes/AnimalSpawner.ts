/**
 * AnimalSpawner - populates the map's animal spawn points and keeps them stocked.
 *
 * Reads every "AnimalSpawnPoint …" marker in the scene at play start, spawns one random animal at
 * each (respecting the island tier — P1 points never spawn a bear, P2 points allow any), and when an
 * animal is killed it respawns a fresh one at that point after `respawnDelay` seconds.
 *
 * Co-op: only the server (or solo play) spawns. Animals go through HuntSpawner so every player,
 * including late joiners, sees the same animals.
 */

import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

import { WildAnimal } from '../animals/WildAnimal.js';
import { SPECIES, P1_SPECIES, P2_SPECIES } from '../data/species.js';
import { isAuthority } from '../systems/Net.js';

import { HuntSpawner } from './HuntSpawner.js';

interface SpawnPoint {
  pos: THREE.Vector3;
  island: 'P1' | 'P2';
  current: WildAnimal | null;
  pending: boolean;     // a spawn request is in flight
  respawnTimer: number; // <0 = occupied/ok, >=0 = counting down to respawn
}

@ENGINE.GameClass()
export class AnimalSpawner extends ENGINE.SceneNode {
  /** Seconds after an animal dies before its point respawns a new one. */
  @ENGINE.property()
  public respawnDelay: number = 30;

  private readonly points: SpawnPoint[] = [];
  private initialSpawnDone = false;

  constructor() {
    super();
    this.canEverTick = true;
  }

  public override beginPlay(): boolean {
    if (!super.beginPlay()) return false;
    const world = this.getWorld();
    // Clients get the server's animals through HuntSpawner; they never spawn their own.
    if (!world || !isAuthority()) return true;

    for (const root of world.getRootNodes()) {
      const name = root.name ?? '';
      if (!name.startsWith('AnimalSpawnPoint')) continue;
      this.points.push({
        pos: root.getWorldPosition(new THREE.Vector3()),
        island: name.includes('(P2)') ? 'P2' : 'P1',
        current: null,
        pending: false,
        respawnTimer: -1,
      });
    }
    // First spawn waits for the first tick, when every node (HuntSpawner included) is in play: a
    // spawn before the spawner begins play would never reach clients.
    return true;
  }

  /** Spawn a random allowed species at a point (through the networked spawner). */
  private spawnAt(p: SpawnPoint): void {
    const spawner = HuntSpawner.find(this.getWorld());
    if (!spawner) return;
    const pool = p.island === 'P2' ? P2_SPECIES : P1_SPECIES; // P1 excludes the bear
    const speciesId = pool[Math.floor(Math.random() * pool.length)];
    if (!SPECIES[speciesId]) return;
    p.pending = true;
    p.respawnTimer = -1;
    void spawner.spawnAnimal(speciesId, p.pos.x, p.pos.y, p.pos.z)
      .then((a) => { p.current = a; })
      .catch((e) => console.warn('[AnimalSpawner] spawn failed', e))
      .finally(() => { p.pending = false; });
  }

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);
    if (!this.initialSpawnDone && this.points.length > 0) {
      this.initialSpawnDone = true;
      for (const p of this.points) this.spawnAt(p);
      return;
    }
    for (const p of this.points) {
      if (p.pending) continue;                     // spawn in flight
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
