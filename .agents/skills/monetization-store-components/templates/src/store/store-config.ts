/**
 * Version of the store templates. Shown in the panel footer and logged at
 * start, so a build can be told apart from an older one. The install script
 * compares it with the shipped templates.
 */
export const STORE_VERSION = '4.1.0';

/**
 * Store configuration for this game. `gameId` is filled from
 * `<project>.genesys-project` by the install script; the other values are the
 * creator's choices and survive template updates.
 */
export interface StoreConfig {
  /**
   * Genesys game id from `<project>.genesys-project`. A published game always
   * receives its real id at runtime. In desktop Play (runtime id "editor") the
   * store host serves the project's linked game and this id is not used.
   * Elsewhere it only names the game in the footer and the start-up log.
   */
  gameId: string;
  /** Keyboard key that toggles the store (lower-case). null disables the hotkey. */
  hotkey: string | null;
  /** Show the always-visible HUD chip (balance + Shop button). false: call store.open() yourself. */
  showHudChip: boolean;
  hudPosition: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  /** Optional accent color for primary buttons and the active tab; null keeps the kit blue. */
  accent: string | null;
  /** Low-opacity line in the panel footer: signed-in state, user id, environment, game id. */
  showSessionInfo: boolean;
}

export const storeConfig: StoreConfig = {
  gameId: '',
  hotkey: 'b',
  showHudChip: true,
  hudPosition: 'top-right',
  accent: null,
  showSessionInfo: true,
};

/** Runtime game ids that do not identify a real game. */
export const PLACEHOLDER_GAME_IDS: ReadonlySet<string> = new Set(['editor', 'dev-game', 'default', 'local', '']);

/** `host`: desktop Play, where the store host serves the project's linked game (set by the controller, never here). */
export type GameIdSource = 'runtime' | 'config' | 'none' | 'host';

export interface ResolvedGameId {
  gameId: string | null;
  source: GameIdSource;
  /** True when the runtime id is real but differs from the configured one. */
  mismatch: boolean;
}

/**
 * A real runtime id (published game) wins; otherwise the configured id;
 * otherwise none. With a placeholder runtime id and a store host (desktop
 * Play) the controller uses the host's game instead.
 */
export function resolveGameId(
  runtimeGameId: string | null | undefined,
  configuredGameId: string,
): ResolvedGameId {
  const runtime = runtimeGameId?.trim() ?? '';
  const configured = configuredGameId.trim();
  const runtimeIsReal = !PLACEHOLDER_GAME_IDS.has(runtime);
  const configuredIsReal = !PLACEHOLDER_GAME_IDS.has(configured);

  if (runtimeIsReal) {
    return { gameId: runtime, source: 'runtime', mismatch: configuredIsReal && configured !== runtime };
  }
  if (configuredIsReal) {
    return { gameId: configured, source: 'config', mismatch: false };
  }
  return { gameId: null, source: 'none', mismatch: false };
}
