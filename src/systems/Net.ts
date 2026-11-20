/**
 * Net - small runtime helpers shared by the co-op code.
 *
 * The same gameplay code runs in three places: solo play (standalone: this machine is the server
 * AND the only player), a co-op dedicated server (headless, owns every outcome) and a co-op browser
 * client (shows server results, sends requests). These helpers name those cases.
 *
 * Read them in beginPlay or later, never in a constructor (NetRuntime is not set yet there).
 */

import * as ENGINE from '@gnsx/genesys.js';

/** True when this machine decides outcomes: solo play or the co-op dedicated server. */
export function isAuthority(): boolean {
  return ENGINE.NetRuntime.isServer();
}

/** True in co-op (connected client or dedicated server); false in solo play. */
export function isOnline(): boolean {
  return !ENGINE.NetRuntime.isStandalone();
}

/** True on the headless co-op server: no rendering, audio or UI. */
export function isHeadless(): boolean {
  return ENGINE.NetRuntime.isHeadless();
}
