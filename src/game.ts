/**
 * Game entry: the GameMode and the game loop.
 *
 * Session: drop-in world — co-op hunting has no rounds or winner; play starts on join, late joiners
 * spawn in, and nothing ends when a player leaves. Solo play (Play button) runs the same rules
 * locally. Co-op (Hunt Together) is matched through the platform's matchmaking.
 */

import * as ENGINE from '@gnsx/genesys.js';

import { GAME_SCENE_URL } from './data/scenes.js';
import { HUNT_SPAWNER_NAME, HuntSpawner } from './nodes/HuntSpawner.js';
import { BarbarianPawn } from './pawns/BarbarianPawn.js';

const PLAYER_SPAWNER_NAME = 'PlayerSpawner';

function isMenuScene(world: ENGINE.World | null): boolean {
  const scenePath = world?.gameLoop?.activeScenePath?.asStringPath ?? '';
  return scenePath.toLowerCase().includes('mainmenu');
}

@ENGINE.GameClass()
class MyGameMode extends ENGINE.GameMode {
  constructor() {
    super();
    // Built-in co-op text chat (no voice). No effect in solo play.
    this.chatEnabled = true;
    this.chatJoinLeaveNotices = true;
  }

  public override initialize(options?: ENGINE.GameModeOptions): void {
    super.initialize({
      ...options,
      // Spawn the playable Barbarian at the PlayerStart, possessed by the default
      // player controller (WASD + mouse camera + jump).
      pawnFactory: async () => BarbarianPawn.create(),
    });
  }

  /**
   * Runs on the server AND on every client before level nodes enter play, so both sides add the
   * spawners at the same node path (spawned entities are matched by that path). The scene does not
   * need to contain them; one placed in the scene in the editor is used instead.
   */
  public override onBeforeBeginPlay(): void {
    super.onBeforeBeginPlay();
    const world = this.getWorld();
    if (!world) return;
    if (!this.findPlayerSpawner()) world.add(ENGINE.PlayerSpawner.create({ name: PLAYER_SPAWNER_NAME }));
    if (!HuntSpawner.find(world)) world.add(HuntSpawner.create({ name: HUNT_SPAWNER_NAME }));
  }

  public override beginPlay(): boolean {
    if (!super.beginPlay()) return false;
    if (ENGINE.NetRuntime.isDedicatedServer()) {
      const world = this.getWorld();
      if (isMenuScene(world)) {
        // The project's start scene is the title menu; a co-op server goes straight to the hunt.
        // openLevel re-admits connected clients through the new level's GameMode.
        void world?.gameLoop?.openLevel(GAME_SCENE_URL);
      } else {
        // Drop-in world: let matchmaking fill a free slot when a hunter leaves.
        this.setAcceptingNewPlayers(true);
      }
    }
    return true;
  }

  /**
   * Suppress the player pawn in the main-menu scene: that scene is only a 3D backdrop for the title
   * screen (a startActive camera renders it), so no Barbarian / HUD should spawn there. Every other
   * scene spawns the pawn as normal. openLevel() to the game scene re-runs onPlayerJoined, so the
   * pawn spawns the moment Play transitions into the real level.
   */
  public override playerCanRestart(controller: ENGINE.PlayerController): boolean {
    if (isMenuScene(this.getWorld())) return false;
    return super.playerCanRestart(controller);
  }
}

class MyGame extends ENGINE.BaseGameLoop {
}

export function main(container: HTMLElement, options?: Partial<ENGINE.BaseGameLoopOptions>): ENGINE.IGameLoop {
  const mergedOptions: Partial<ENGINE.BaseGameLoopOptions> = {
    ...options, // carries the host's game id and matchmaking client — never set those here
    defaultGameModeClass: MyGameMode,
  };
  const game = new MyGame(container, mergedOptions);
  return game;
}
