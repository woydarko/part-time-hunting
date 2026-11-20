# Tweened props and moving platforms

Two tween APIs share one owner, Tween.js through the engine's `world.tweenManager`, plus a curve follower for platforms. None of them is a pawn's locomotion (`genesys-movement`) or a particle effect (`genesys-vfx`).

| Need | API | Source |
| --- | --- | --- |
| Editor-authored move, rotate, or scale on a node, including auto-start | `ENGINE.TweenMovementNode` | `.engine/src/nodes/movement/TweenMovementNode.ts` |
| A tween created from gameplay code | `world.tweenManager.createTween(object).to(...).start(world.tweenManager.getCurrentTime())` | the same file's class comment and `startTween`; manager class `.engine/src/systems/TweenManager.ts` |
| A platform or lift following a route (riders are carried, *Riding a moving platform*) | `ENGINE.PathMovementNode` | `.engine/src/nodes/movement/PathMovementNode.ts` |

Read `TweenMovementNode.ts` before adding fields. Its header comment is the supported code shape for `world.tweenManager`.

## Time units

- `TweenMovementNode.duration` is in **seconds** (option comment "Duration in seconds"; `startTween` multiplies by 1000).
- `world.tweenManager` tweens use **milliseconds**: `.to(target, 400)` is 0.4 s. The manager advances its own clock by `deltaTime × 1000` each world tick. `getCurrentTime()` returns that clock in ms.
- `DoorNode.animationDuration` is in seconds.
- `world.timerSystem.setTimeout` / `setInterval` take seconds.

The manager only advances while the world ticks, so pause stops tweens, and the world's slow-motion factor scales them.

## `TweenMovementNode`

| Property / option | Default | Notes |
|---|---|---|
| `duration` | `1` s | |
| `targetPosition` | `(0, 0, 0)` | **World** position the root moves to. Not an offset. |
| `targetRotation` | `(0, 0, 0)` | Degrees, applied as world rotation. |
| `targetScale` | `(1, 1, 1)` | World scale. |
| `easing` | `'Cubic.InOut'` | `TweenEasingType`: `Linear`, and `In` / `Out` / `InOut` for `Quadratic`, `Cubic`, `Quartic`, `Quintic`, `Sinusoidal`, `Exponential`, `Circular`, `Elastic`, `Back`, `Bounce` (for example `'Back.Out'`). |
| `loop` | `'NoLoop'` | `'Loop'` snaps back to the start pose and replays. There is no ping-pong; use `PathMovementNode` or a code tween with `yoyo` for back-and-forth. |
| `autoStart` | `false` | Start on `beginPlay`. |

Methods: `startTween()`, `stopTween()`, `resetToStart()`. The start pose is the root's world transform at `beginPlay`. It moves the node's **root** (`getRoot()`), not the node itself. Every target field is applied, so leaving `targetRotation` at 0 rotates the prop to 0, and leaving `targetScale` at 1 rescales it to 1. Set all three to the intended end pose. In the editor, selecting the node draws a debug line and arrow to the target.

Placement: add it to a placed prop with MCP (`action_node(add, className="ENGINE.TweenMovementNode", parentComponentId=<prop>)`, then `setProperties`; see `genesys-mcp-orchestrator`). Trigger it from gameplay by finding the node and calling `startTween()` (for example from a switch's `onActivated`).

## `world.tweenManager`

API: `createTween(obj)` (tracked; auto-removed on complete or stop, also with your own `.onComplete` / `.onStop`; starting it again re-tracks it), `addTween(t)`, `removeTween(t)` (untracks without stopping), `stopTween(t)`, `getCurrentTime()` (ms), `getActiveTweenCount()`, `destroy()`.

A tween from `createTween` runs on the manager's game clock. Pass `world.tweenManager.getCurrentTime()` to `.start()`, as the engine does: the project's lint rule `custom/tween-time-argument` rejects a bare `.start()`. (Without an argument `createTween` tweens still fall back to that clock, as do `.pause()` and `.resume()`.)

Source: .engine/src/nodes/movement/TweenMovementNode.ts (`startTween`), .engine/src/systems/TweenManager.ts — typechecked against 18.1.0-alpha.317
```ts
const state = { y: platform.position.y };
const tween = world.tweenManager.createTween(state)
  .to({ y: state.y + 3 }, 1500)                      // ms
  .easing((k: number) => k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2)
  .onUpdate(() => { platform.position.y = state.y; })
  .onComplete(() => { /* arrived */ })              // the manager still untracks the finished tween
  .start(world.tweenManager.getCurrentTime());     // the manager's game clock (lint requires the argument)
// Cancel: world.tweenManager.stopTween(tween);
```

- A tween handed to `addTween` keeps Tween.js's wall-clock default: start it with `world.tweenManager.getCurrentTime()`, or it starts late or jumps. It is also never auto-removed; call `removeTween` when it finishes.
- `@tweenjs/tween.js` is bundled inside the engine and is not a dependency of the game project, so `import * as TWEEN from '@tweenjs/tween.js'` does not resolve. Pass an easing function `(k: number) => number` as above, or use `TweenMovementNode` with an easing name.
- The header comment's example writes `TWEEN.Easing.Cubic.InOut` and `.start()` with no time. Follow `startTween` instead.

## `PathMovementNode`

| Option | Default | Notes |
|---|---|---|
| `path` | required | `THREE.Curve<THREE.Vector3>` in world space (for example `new THREE.CatmullRomCurve3(points)` or `new THREE.LineCurve3(a, b)`). |
| `speed` | `5` | Units per second along the curve. |
| `loop` | `'NoLoop'` | `'Loop'` wraps to the start; `'PingPong'` reverses at each end. |
| `autoStart` | `false` | |

Methods: `startMovement()`, `stopMovement()`, `isMoving()`, `setProgress(0..1)`.

Each tick it moves the root by the delta to the next curve point. If the root's `PrimitiveNode` is `KinematicPositionBased` or `KinematicVelocityBased`, it also sets the body's linear velocity, which pushes **dynamic** bodies resting on it. Characters standing on it ride along (*Riding a moving platform*). The curve is a code object, so create it in code (a `GAME` platform class) rather than through MCP properties.

## Riding a moving platform

A kinematic floor carries a grounded classic character (`CharacterMovementNode`: players and NPCs):

- Rapier's character controller adds the floor's velocity at the contact to each step, so a sliding or rising platform carries the rider and walls still stop it. On some steps it drops the move, so a rider falls a little behind (*Limitations*).
- The character turns with a turning floor and follows a falling one, which the controller leaves out.
- Jumping or walking off keeps the floor's sideways speed. Set `impartPlatformVelocity = false` on the movement node to drop it.
- `movement.groundNode` is the body the character stands on, or null in the air.

The floor needs a kinematic body moved through its node (`PathMovementNode`, `TweenMovementNode`, or code writing the root's position or rotation); the physics sync gives the body a velocity from that move. A static body moved by code has no velocity and carries nothing. A move of more than 50 m/s in one step counts as a teleport and leaves riders behind. GSS riders snap back when you write their position; carry them through the sim (`genesys-movement`).

## Physics rules

- A **static** body that moves leaves the physics world out of step. Give moving props a kinematic motion type.
- A **dynamic** body is moved by the physics engine. Tweening its transform fights the simulation. Tween a kinematic or non-physics node, or teleport through the physics API (`teleportBody`, `genesys-physics`).
- Never drive the same transform from two sources (a `TweenMovementNode` and code, or a tween and `PathMovementNode`).
- Navmesh bakes ignore kinematic and dynamic geometry, so NPCs do not path onto moving platforms (`genesys-navigation`).

## Bar

The player can see the motion start and finish. A door or lift that pops to its end pose skipped the tween, or got milliseconds where seconds were expected. Motion that matters gets a sound at start and stop (`genesys-audio`).

## Limitations

- A rider falls about a tenth behind a sliding platform or a turntable, more in multiplayer when a client's input arrives unevenly → on a kinematic floor Rapier's character controller drops the whole move on some steps (a Rapier bug, reported as https://github.com/dimforge/rapier/issues/1072) → keep platform rides short, and do not rely on a rider keeping exact pace with the platform (verify in Play).
- A character barely walks on a platform while it is stopped, or on a kinematic floor that never moves → the same Rapier bug stops most moves along a kinematic body at rest → give floors that never move a static body, and keep a moving platform's stops short (verify in Play).

## Traps

- Tweens pile up (`getActiveTweenCount()` keeps rising) → tweens added with `addTween` are never auto-removed → `removeTween` when each finishes, or create them with `createTween`.
- A tween added with `addTween` starts late or jumps → its `.start()` with no argument used the wall clock → pass `world.tweenManager.getCurrentTime()`.
- Door or lift pops to the end pose → no tween ran, or `duration` was given in ms to `TweenMovementNode` (1000 = 16 minutes) → seconds on the node, milliseconds in `.to()`.
- Player sinks into a moving platform → the platform was tweened as a static body, or a dynamic body was tweened while simulated → kinematic root plus `PathMovementNode` (it drives kinematic velocity), or move through `teleportBody` (`genesys-physics`).
- `import * as TWEEN from '@tweenjs/tween.js'` fails to build → it is bundled inside the engine, not a game dependency → use `TweenMovementNode` easing names, or pass an easing function.
