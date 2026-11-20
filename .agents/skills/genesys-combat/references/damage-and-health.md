# Damage and health

Source of truth: `.engine/src/nodes/CharacterStatsNode.ts`.

## `CharacterStatsNode`

A non-spatial `SceneNode`. Put one on each damageable root, classic or GSS. GSS pawns use it too: `GSSTags.Health` / `GSSTags.Ammo` are attribute keys that no engine damage, weapon, or pickup path reads.

| Option / property | Default | Notes |
|---|---|---|
| `maxHealth` | `100` | Current health resets to max at `initialize`, `postLoad`, and `beginPlay`. |
| `healthRegen` | `1` per second | Heals every `tickPrePhysics` while below max. Set `0` for most games. |
| `attackCooldown` | `1.0` s | Stat only; nothing in the engine reads it automatically. |
| `attackRange` | `2.0` | Stat only. |
| `attackDamage` | `10` | Stat only. |
| `speed` | `5.0` | Stat only. |
| `deathPolicy` | `DeathPolicy.DestroyRoot` | `DeathPolicy.Keep` leaves the root after death, for a respawn or a death beat. |

Methods:
- `takeDamage(event: DamageEvent) → number` returns damage actually dealt. Returns `0` when already dead; a negative amount deals 0. Clamps at 0, fires `onHealthChanged(current, max)`, then `onDamaged(event, dealt)`, and at 0 sets dead, fires `onDeath(event)`, then calls `handleDeath(event)`.
- `heal(amount) → number` returns the amount healed. No-op when dead or amount is 0. Fires `onHealthChanged`.
- `revive(health = maxHealth)` clears dead, clamps health to `[1, maxHealth]`, fires `onHealthChanged`, and fires `onRevive` if it was dead.
- Getters: `getIsDead`, `getMaxHealth`, `getCurrentHealth`, `getHealthRegen`, `getAttackCooldown`, `getAttackRange`, `getSpeed`, `getAttackDamage`.
- Setters: `setMaxHealth` (clamps current and fires `onHealthChanged`), `setHealthRegen`, `setAttackCooldown`, `setAttackRange`, `setSpeed`, `setAttackDamage`.
- `protected handleDeath(event)` applies `deathPolicy`: with the default `DestroyRoot` it destroys `getRoot()` synchronously, inside the `takeDamage` call that killed it. Override it for a custom death (`EnemyHealth` below).

`DamageEvent` = `{ amount; type?; instigator?; causer?; hitLocation?; hitNormal?; impulse? }`. The engine sources fill every field but `impulse`, which they set only when the source's `knockback` is above 0: `instigator` is the shooter's or NPC's root, `causer` the projectile, weapon or NPC, `type` the source's `damageType` (empty by default). A projectile takes `hitLocation` and `hitNormal` from the physics contact, which can lack them, so guard `hitLocation` for `undefined`.

Who deals damage: `Projectile.onHit`, `InstantHitWeaponNode.applyDamage`, and `MeleeAttackAction`, all through `ENGINE.applyDamage`. `HealthPickupNode` calls `heal` and only accepts pawns that have this node. `HpAbovePercentCondition` and `TargetBelowHpPercentCondition` read it.

## Patterns

**Player health.** Subclass as `Health` below (i-frames and a team). Create it with `healthRegen: 0` and `deathPolicy: ENGINE.DeathPolicy.Keep` to keep the pawn.

Source: .engine/src/nodes/CharacterStatsNode.ts (`takeDamage(event)` public)
```ts
@ENGINE.GameClass()
export class Health extends ENGINE.CharacterStatsNode {
  @ENGINE.property() public team: number = 0;
  @ENGINE.property() public invulnerableSeconds: number = 0.6;
  private invulnerableUntil = 0;

  public override takeDamage(event: ENGINE.DamageEvent): number {
    if (event.instigator?.getNode(Health)?.team === this.team) return 0; // no friendly fire
    const now = this.getWorld()?.gameTime ?? 0;
    if (now < this.invulnerableUntil) return 0;
    const dealt = super.takeDamage(event);
    if (dealt > 0) this.invulnerableUntil = now + this.invulnerableSeconds;
    return dealt;
  }
}
// Keep leaves the pawn; the GameMode listens to onDeath and opens the result screen.
// Health.create({ maxHealth: 100, healthRegen: 0, deathPolicy: ENGINE.DeathPolicy.Keep });
```

The rest of the player flow: The GameMode subscribes to `onDeath` and moves to the result state (`genesys-game-boot`). On Retry, call `revive()` or respawn the pawn.

Source: .engine/demos/examples/side-scroller-advanced/player.ts
```ts
public override beginPlay(): boolean {
  if (!super.beginPlay()) return false;
  this.add(ENGINE.CharacterStatsNode.create({ maxHealth: 100, healthRegen: 0 }));
  return true;
}
```

**Enemy health.** Created with the enemy root. The GameMode counts kills from `onDeath`. The demo uses the base class, so its enemies vanish on the killing frame; for a death beat use `EnemyHealth` (below) in place of `CharacterStatsNode`.

Source: .engine/demos/examples/fps-advanced/enemies.ts, game-mode.ts
```ts
this.healthNode = ENGINE.CharacterStatsNode.create({
  name: 'HealthStats', maxHealth: 100, healthRegen: 0,
});
this.add(meshNode, this.healthNode);
// GameMode:
enemy.getNode(ENGINE.CharacterStatsNode)?.onDeath.add(() => this.onEnemyKilled());
```

**Health bars and damage numbers.** HUD bar: `ProgressBar` updated from `onHealthChanged`. Overhead enemy bars and floating damage numbers are world-space UI (`UI3DNode` hosting a `ProgressBar` or text, as in fps-advanced `enemies.ts`); `genesys-ui` owns the recipe, placement, and styling.

**Lives.** Keep a lives count in the GameMode. On player `onDeath`, decrement, then `revive()` and move the pawn to its spawn point, or open the result at 0.

**Invulnerability windows.** The engine has no i-frame field. Override `takeDamage` and compare `world.gameTime` against an `invulnerableUntil` time (`Health`, above). Show the window: blink the mesh at 10–15 Hz or tint it. A window nobody can see reads as a bug.

**Teams and friendly fire.** The engine has no team concept. Add a `team` number to your stats subclass and compare it with the `event.instigator`'s in the `takeDamage` override (`Health`, above). Every engine source sets `instigator`, and so must your own melee and hazards.

**Damage modifiers.** Armour and resistances go in the receiver's `takeDamage` override (read `event.type`). Headshots and weak spots: a child node on the head collider's path that implements `IDamageable` and forwards a scaled event to the root's stats (`applyDamage` finds it before the root). Distance falloff goes in the attacker: `InstantHitWeaponNode.applyDamage(hit, event)` has `hit.distance`. Explosions: `ENGINE.applyAreaDamage` with `edgeScale`.

**Knockback.** Put it on the hit: `impulse` on a `DamageEvent` is a world velocity change in m/s. The engine sources fill it from `knockback` (m/s): on a weapon (`BaseWeaponNode`, along the shot, once per pellet that hits), on a `Projectile` (along its launch direction; a projectile weapon passes its own), and on `MeleeAttackAction` (away from the NPC). `applyAreaDamage` takes `impulseSpeed`, pointing out from the centre and scaled like the damage.

`applyDamage` launches the hit actor's `ILaunchable`, which is a character's movement node, with a 0.2 s steering lock, else changes its dynamic body's velocity. Either way the push adds to the current velocity: a jumping character keeps rising, and hits in one frame add up. A receiver that refuses a positive amount (returns 0: i-frames, friendly fire) is not pushed. A crate with nothing damageable is still pushed. `ENGINE.applyImpulse(hitNode, impulse)` pushes without damage. Character pawns are kinematic, so physics velocity writes do nothing to them; for a dash or a custom lock call `launch` on the movement node (`genesys-movement`, jump-and-knockback reference).

**Hit feedback.** Hit flash (per-instance material clone or scale pop), hitstop, and screen shake are owned by `genesys-game-feel`; call them from `onHealthChanged` when health went down.

## Death flow

1. `onDeath` fires before `handleDeath`. The root still exists, so read its position here.
2. Reaction (in `onDeath` listeners): VFX burst plus sound at the hit location or the root position (`genesys-vfx`, `genesys-audio`), and the creature's death beat — a death clip if the model has one, else a tip-over/shrink tween (`genesys-creatures`). For big moments, add hitstop or shake (`genesys-game-feel`).
3. Stop mattering (in `handleDeath`): `root.overridePhysicsOptions({ enabled: false })` so shots pass through, stop the brain (`getNode(ENGINE.BehaviorTreeNode)?.stopBehaviorTree()`), stop movement (`NpcMovementNode.stop()` or `AIController.stopMovement()`).
4. Remove (in `handleDeath`): `world.timerSystem.setTimeout(() => root.destroy(), 0.5)` (seconds), or hide and recycle it (the fps-advanced weapon pickup hides with `visible = false` and disables physics, then re-enables on a timer).

Steps 3–4 replace the default `handleDeath`. With the default `deathPolicy`, the root is already destroyed when step 2 ends, so a timer in `onDeath` never matters and nothing can play on the body.

Source: Composed — typechecked against 18.1.0-alpha.317 (`CharacterStatsNode.handleDeath`, `TimerSystem.setTimeout`, `BehaviorTreeNode.stopBehaviorTree`)
```ts
@ENGINE.GameClass()
export class EnemyHealth extends ENGINE.CharacterStatsNode {
  @ENGINE.property() public team: number = 1;
  @ENGINE.property() public removeAfterSeconds: number = 0.5;  // the death beat

  // Replaces the default (destroy the root this frame). onDeath listeners already ran:
  // they play the reaction and count the kill while the body still exists.
  protected override handleDeath(): void {
    const root = this.getRoot();
    const world = this.getWorld();
    if (!root || !world) { root?.destroy(); return; }
    root.overridePhysicsOptions({ enabled: false });          // shots pass through
    root.getNode(ENGINE.BehaviorTreeNode)?.stopBehaviorTree(); // stops acting
    root.getNode(ENGINE.NpcMovementNode)?.stop();              // stops walking
    world.timerSystem.setTimeout(() => root.destroy(), this.removeAfterSeconds);
  }
}
```

GSS enemies stop with `AIController.stopMovement()` instead of `NpcMovementNode.stop()`.

## Multiplayer

Damage and death are authoritative. Apply `takeDamage` only where `node.hasAuthority()` is true (server or standalone). Replicate health to clients and play reactions on every client. `AIController` sets `replicated = false` because AI runs on the authority. The replication, RPC, and spawner details are in `genesys-multiplayer`.

## Bugs

- Player health creeps back up → `healthRegen` defaults to 1/s → set `healthRegen: 0`.

## Traps

- The player pawn vanishes at 0 HP and the game hangs → the default `deathPolicy` destroyed the root → create its stats with `deathPolicy: ENGINE.DeathPolicy.Keep`; let the GameMode open the result.
- Damage lands but the target never reacts → nothing `IDamageable` on the path from the hit collider to its root, or in that root's subtree (`applyDamage` searches those) → add a `CharacterStatsNode` to the root, not to a deep child of another root. A code-built root that is not a pawn needs `isRoot` (`genesys-engine`).
- A dead enemy still blocks shots → the collider outlived the death → `EnemyHealth` disables it.
- Enemy cooldowns finish during pause or ignore slow motion → a custom action times with `Date.now()` → use `blackboard.gameTime`, as `ShootAction`, `MeleeAttackAction`, and `WaitAction` do (`behavior-tree`).
