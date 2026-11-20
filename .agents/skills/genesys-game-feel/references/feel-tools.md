# Feel tools: shake, hit flash, hitstop

The short version is in [SKILL.md → Build](../SKILL.md#build). The engine has screen shake; hit flash and hitstop are small runtime tools that fill the gap. Numbers come from SKILL.md → *Defaults*.

## Screen shake

The engine runs camera shakes on each `PlayerController`, so a shake belongs to the player who sees it. A kind of shake is a class registered with `@ENGINE.GameClass()`; tune the built-in `NoiseShake` by overriding its field defaults.

Source: .engine/src/entities/CameraShake.ts, .engine/src/entities/PlayerController.ts
```ts
/** A hit taken: quick and small. Intensity 0.3 lasts 0.15 s. */
@ENGINE.GameClass()
export class HitShake extends ENGINE.NoiseShake {
  public override decayPerSecond = 2;
}

/** An explosion: wider and a little longer. */
@ENGINE.GameClass()
export class ExplosionShake extends ENGINE.NoiseShake {
  public override maxOffset = 0.2;
  public override decayPerSecond = 1.5;
}

/** A health node shakes its player's screen when hit (it does nothing on an enemy). */
@ENGINE.GameClass()
export class PlayerHealth extends ENGINE.SceneNode implements ENGINE.IDamageable {
  public takeDamage(event: ENGINE.DamageEvent): number {
    ENGINE.PlayerController.findFrom(this)?.playCameraShake(HitShake, 0.3);
    return event.amount;
  }
}

/** An explosion shakes every player near it, less with distance. */
export function explode(world: ENGINE.World, center: THREE.Vector3): void {
  ENGINE.playCameraShakeAt(world, ExplosionShake, center, 0.6, 15);
}
```

- Playing a class that is already running adds to its `intensity` (0–1, capped at 1), so rapid hits merge into one shake. Different classes run side by side and their offsets add up.
- `NoiseShake` follows the trauma model: smooth noise sized by intensity², so small hits stay subtle. Defaults: `maxOffset` 0.12 m, `maxAngle` 0.03 rad, `frequency` 15, `decayPerSecond` 2 (a full shake lasts 0.5 s).
- The engine applies the offset to the camera the player views only while the frame is drawn, then puts it back. It works on every rig, follows camera cuts, and never moves aim traces or the audio listener.
- Shakes run on real time, so they keep going during hitstop (`world.addTimeScale(0)`).
- While the game is paused (`world.paused`) shakes hold where they are, so the camera keeps its offset behind a pause menu, and they go on after.
- `controller.cameraShakeScale` scales every shake for that player; a "reduce screen shake" setting sets 0.
- `ENGINE.PlayerController.findFrom(node)` is the player controller of the pawn `node` is on (the node itself, or the nearest pawn above it). It is null for an enemy and for a node on no pawn, hence `?.`.
- Online, a server's `playCameraShake` on a remote player's controller is sent to that client by class name, and the client builds the class from the class registry. An unregistered class throws. `playCameraShakeAt` reaches each player once: call it from server or single-player gameplay, not from effect code that runs on the server and every client too.

Your own shake extends `ENGINE.CameraShake`. `update` gets real seconds, adds camera-local metres and radians to `out`, and returns false to end:

```ts
/** A recoil kick: pitch up, fading fast. */
@ENGINE.GameClass()
export class RecoilKick extends ENGINE.CameraShake {
  public override update(deltaTime: number, out: ENGINE.CameraShakeOffset): boolean {
    this.intensity = Math.max(0, this.intensity - deltaTime * 6);
    out.rotation.x += 0.05 * this.intensity;
    return this.intensity > 0;
  }
}
```

## Hit flash and scale pop

Flash only a material this instance owns. `ModelMeshNode` shares the loaded GLB's materials across instances, so flashing one flashes every enemy of that model. `useDynamicMaterials: true` makes the engine clone this instance's materials once, when the model loads in Play. Scale pop needs no material and costs nothing; it is the default for crowds (10+ alive), since per-instance materials also break batching (`genesys-profiler`).

Source: .engine/src/nodes/visual/ModelMeshNode.ts (`useDynamicMaterials`, `cloneMaterials`), .engine/src/systems/TweenManager.ts — composed, typechecked against 18.1.0-alpha.317
```ts
// At spawn: the engine clones this instance's materials once when the model loads in Play.
export const enemyBody = ENGINE.ModelMeshNode.create({
  modelUrl: '@engine/assets/models/SM_Capsule.glb',  // blockout; the real enemy model
  useDynamicMaterials: true,
});

/** White emissive flash for ~120 ms. Only on a ModelMeshNode created with useDynamicMaterials. */
export function hitFlash(model: ENGINE.ModelMeshNode, seconds = 0.12): void {
  const lit: { color: THREE.Color; was: THREE.Color }[] = [];
  model.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    for (const m of [o.material].flat()) {
      const emissive = (m as { emissive?: unknown }).emissive;
      if (emissive instanceof THREE.Color) lit.push({ color: emissive, was: emissive.clone() });
    }
  });
  for (const e of lit) e.color.setRGB(1, 1, 1);
  world.timerSystem.setTimeout(() => { for (const e of lit) e.color.copy(e.was); }, seconds);
}

/** Scale pop 1 → 1.15 → 1 over ~120 ms. Free: no material change. */
export function scalePop(node: ENGINE.SceneNode, peak = 1.15, ms = 120): void {
  const base = node.scale.clone();
  const s = { k: 1 };
  world.tweenManager.createTween(s)
    .to({ k: peak }, ms / 2).yoyo(true).repeat(1)
    .onUpdate(() => node.scale.copy(base).multiplyScalar(s.k))
    .onComplete(() => node.scale.copy(base))
    .start(world.tweenManager.getCurrentTime());
}
```

Pop the visual child (the model), not a physics root: scaling a root rescales its collider. Restore the pose in `onComplete` so overlapping pops never drift the scale.

## Hitstop

Freeze only the two bodies in the exchange: `setTickEnabled(false)` stops a node's `tickPrePhysics` and `tickPostPhysics` (`TickManager` skips it), and `AnimationStateMachineNode` advances its mixer only in `tickPostPhysics`, so the pose holds. The tick manager hands a re-enabled node a normal frame delta, so nothing jumps on release.

Source: .engine/src/nodes/SceneNode.ts (`setTickEnabled`), .engine/src/game/TickManager.ts, .engine/src/nodes/visual/AnimationStateMachineNode.ts (`tickPostPhysics` → `mixer.update`), .engine/src/systems/TimerSystem.ts — composed, typechecked against 18.1.0-alpha.317
```ts
/**
 * Freeze attacker and victim for 40–60 ms (80–120 ms for a boss hit or the player's death).
 * Everything else keeps running. Single-player or local-only visuals; never online sim state.
 */
export function hitstop(world: ENGINE.World, roots: ENGINE.SceneNode[], seconds = 0.05): void {
  const frozen: ENGINE.SceneNode[] = [];
  for (const root of roots) {
    const nodes = [root, ...root.getNodes(ENGINE.BasePawnMovementNode),
      ...root.getNodes(ENGINE.AnimationStateMachineNode)];
    for (const node of nodes) {
      if (!node.isTickEnabled()) continue;          // already frozen by an earlier hit
      node.setTickEnabled(false);                    // stops tickPre/PostPhysics; anim mixer stops advancing
      frozen.push(node);
    }
  }
  world.timerSystem.setTimeout(() => { for (const n of frozen) n.setTickEnabled(true); }, seconds);
}
```

Projectiles, particles, other enemies and the music keep running, which is what makes it read as impact rather than lag. On a GSS pawn this freezes the animation but the simulation keeps stepping (verify in Play); online, hitstop is visual and local only and never pauses other players (`genesys-multiplayer`).
