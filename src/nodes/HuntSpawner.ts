/**
 * HuntSpawner - the one MultiplayerSpawner for runtime-spawned hunting entities (animals and loot).
 *
 * The server (or solo play) calls these @SpawnMethods; every connected client, including players
 * who join later, re-runs the same recipe with the same arguments, so they build matching animals
 * and loot that the replication channel then keeps in sync. GameMode places one instance in every
 * world before play starts, so server and clients share the same stable spawner path.
 */

import * as ENGINE from '@gnsx/genesys.js';

import { WildAnimal } from '../animals/WildAnimal.js';
import { DROP_ITEMS } from '../data/animals.js';
import { SPECIES } from '../data/species.js';

import { LootDrop } from './LootDrop.js';

/** Node name the GameMode gives the spawner; it must be identical on server and clients. */
export const HUNT_SPAWNER_NAME = 'HuntSpawner';

const POS_PARAM = { netType: 'float', quantization: { mode: 'scale', scale: 100 } } as const;

@ENGINE.GameClass()
export class HuntSpawner extends ENGINE.MultiplayerSpawner {
  /** The world's spawner, or null before the GameMode has placed it. */
  public static find(world: ENGINE.World | null | undefined): HuntSpawner | null {
    return world?.getNode(HuntSpawner) ?? null;
  }

  /** Spawn one animal of `speciesId` at a world position (server / solo only). */
  @ENGINE.SpawnMethod({ params: [null, POS_PARAM, POS_PARAM, POS_PARAM] })
  public async spawnAnimal(speciesId: string, x: number, y: number, z: number): Promise<WildAnimal | null> {
    const cfg = SPECIES[speciesId];
    if (!cfg) return null;
    return WildAnimal.fromConfig(cfg, x, y, z);
  }

  /** Spawn one loot pickup. `lootId` is the server-assigned id players use to request the pickup. */
  @ENGINE.SpawnMethod({ params: [{ netType: 'uint' }, null, POS_PARAM, POS_PARAM, POS_PARAM] })
  public async spawnLoot(lootId: number, itemId: string, x: number, y: number, z: number): Promise<LootDrop | null> {
    const item = DROP_ITEMS[itemId];
    if (!item) return null;
    return LootDrop.fromItem(lootId, item, x, y, z);
  }
}
