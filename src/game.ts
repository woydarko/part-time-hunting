/**
 * Empty game template - minimal starting point for custom game development.
 */

import * as ENGINE from '@gnsx/genesys.js';

import { BarbarianPawn } from './pawns/BarbarianPawn.js';

@ENGINE.GameClass()
class MyGameMode extends ENGINE.GameMode {
  constructor() {
    super();
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
   * Suppress the player pawn in the main-menu scene: that scene is only a 3D backdrop for the title
   * screen (a startActive camera renders it), so no Barbarian / HUD should spawn there. Every other
   * scene spawns the pawn as normal. openLevel() to the game scene re-runs onPlayerJoined, so the
   * pawn spawns the moment Play transitions into the real level.
   */
  public override playerCanRestart(controller: ENGINE.PlayerController): boolean {
    const scenePath = this.getWorld()?.gameLoop?.activeScenePath?.asStringPath ?? '';
    if (scenePath.toLowerCase().includes('mainmenu')) return false;
    return super.playerCanRestart(controller);
  }
}

class MyGame extends ENGINE.BaseGameLoop {
}

export function main(container: HTMLElement, options?: Partial<ENGINE.BaseGameLoopOptions>): ENGINE.IGameLoop {
  const mergedOptions: Partial<ENGINE.BaseGameLoopOptions> = {
    ...options,
    defaultGameModeClass: MyGameMode,
  };
  const game = new MyGame(container, mergedOptions);
  return game;
}
