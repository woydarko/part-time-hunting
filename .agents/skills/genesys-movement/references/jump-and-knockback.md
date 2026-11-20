# Jump feel, knockback and launch

Owner for variable jump height, jump buffer, fast fall, coyote time, knockback and launch pads on both stacks. Other skills point here.

## Jump numbers

Gravity is `physicsEngine.getOptions().gravity.y` (−9.81) × `simulatedGravityScale` (5 in the default character-controller options) = −49.05 m/s². Both stacks add gravity before moving (semi-implicit), so the real apex is about `jumpSpeed × dt / 2` lower than the formula (0.1 m at 60 fps for 12 m/s).

| Quantity | Formula | Default (`jumpSpeed` 12) |
|---|---|---|
| Apex | jumpSpeed² / 98.1 | 1.47 m (≈ 1.4 m at 60 fps) |
| Time to apex | jumpSpeed / 49.05 | 0.24 s |
| Airtime, flat ground | jumpSpeed / 24.5 | 0.49 s |
| Speed for a wanted apex | √(98.1 × apex) | 1 m → 9.9, 1.5 m → 12.1, 2 m → 14.0, 3 m → 17.2 |

Classic only: `jump(strength)` sets `verticalVelocity = jumpSpeed × strength × effectiveJumpStrengthModifier`, which is `jumpStrengthModifier` (on `BasePawnMovementNode`, default 1) times every entry of `jumpStrengthMultipliers`. Power-ups add a key (`jumpStrengthMultipliers.set('boots', 1.3)`) and delete it when they end; apex scales with the square (1.5 → 2.25× height). GSS has no modifier; change the mode's `jumpSpeed`, or launch with an effect (below).

Typical platformer: apex 1.5–2.5 m, `maxMidAirJumps` 1, air acceleration lambda 8–12, jump cut 0.4, coyote 100–120 ms, buffer 100–150 ms, fall gravity ×1.5–1.8.

## Classic stack: settings on `CharacterMovementNode`

The platformer jump is built in. `DefaultPlayerController` calls `jump()` on press and `stopJump()` on release (keyboard Space, gamepad face-bottom, and through `setJumpEdges` on a predicted client).

- `jumpCutScale`: share of upward speed kept when jump is released while rising. Default `1`: a tap is a full jump. Set 0.4–0.5 for variable height.
- `jumpBufferTime`: a press in the air with no jump left is kept this long (default 0.1 s) and jumps on landing; a buffered press already released lands as a short hop.
- `fallGravityScale`: gravity multiplier while moving down (default `1`).
- `coyoteTime`: after walking off a ledge, `canGroundJump` stays true this long (default 0.1 s of game time; 0 turns it off). A coyote jump does not use an air jump, and any jump ends the coyote window. `isGrounded` turns false at once.
- `onJumped(fromGround)` and `onLanded(fallSpeed)` fire once per jump and landing, for dust, sounds and squash. They fire where movement runs (the owning client and the server, or standalone), not on other players' copies, and not while a server correction replays moves.
- The cut applies only to a rise started by `jump()`. A jump pad that calls `jump()` can be cut by a release, so use `launch` instead (below).

Source: .engine/src/nodes/movement/CharacterMovementNode.ts
```ts
@ENGINE.GameClass()
export class PlatformerHero extends ENGINE.DefaultCharacterPawn {
  protected override createMovementNode(): ENGINE.BasePawnMovementNode {
    return ENGINE.CharacterMovementNode.create({ name: 'MovementNode', jumpSpeed: 16, maxMidAirJumps: 1,
      jumpCutScale: 0.4, jumpBufferTime: 0.12, fallGravityScale: 1.6,
      midAirAccelerationLambda: 10, midAirDecelerationLambda: 4 });
  }
}
```

For a side-scroller, create `DirectionalCharacterMovementNode` with the same options. Feel numbers are tuned by eye: verify in Play.

## GSS stack: feel modes

GSS derives the jump edge from input tags; there is no coyote field and no `stopJump`. Subclass the two character modes and re-register them under the same ids. All state lives in custom data so correction replay reproduces it. The stock modes already mix an effect's Y onto the jump or the current vertical speed inside `generateMove`, so a launch works without these subclasses. The pair only remembers a launch so the variable-height cut leaves it alone. `tick` reads `move.velocity.y` and then adds gravity; it does not read `ctx.getVelocityY()` for that speed, so a feel change belongs on the desired move before `super.tick`.

Source: .engine/src/gameplay-sim/modes/GSSWalkingMode.ts, GSSFallingMode.ts, GSSMoveMix.ts (composed — typechecked against 18.1.0-alpha.317)
```ts
const AIR = 'feel.air', JUMPED = 'feel.jumped', BUFFER = 'feel.buffer', LAUNCHED = 'feel.launched';
const JUMP = ENGINE.GSSTags.InputJump;
export const FEEL = { coyote: 0.1, buffer: 0.12, cut: 0.4, fallGravity: 1.6 };

export class FeelWalkingMode extends ENGINE.GSSWalkingMode {
  public override generateMove(ctx: ENGINE.GSSMovementContext, proposals: readonly ENGINE.GSSProposedMove[]): ENGINE.GSSDesiredMove {
    const move = super.generateMove(ctx, []);                 // input, and jumpSpeed when Jump was just pressed
    if (ENGINE.gssGetFloat(ctx.custom, BUFFER) > 0) move.velocity.y = this.jumpSpeed; // press arrived just before landing
    return ENGINE.mixProposedMoves(move, proposals);          // a launch still mixes onto that jump
  }
  public override tick(ctx: ENGINE.GSSMovementSimContext, move: ENGINE.GSSDesiredMove, dt: number): void {
    const buffered = ENGINE.gssGetFloat(ctx.custom, BUFFER) > 0;
    const seed = super.generateMove(ctx, []);
    if (buffered) seed.velocity.y = this.jumpSpeed;
    const launched = move.velocity.y > 0 && move.velocity.y !== seed.velocity.y; // an effect changed Y
    super.tick(ctx, move, dt);
    ENGINE.gssSetFloat(ctx.custom, AIR, 0);
    ENGINE.gssSetBool(ctx.custom, JUMPED, buffered || ctx.newInputTags.has(JUMP) || launched);
    ENGINE.gssSetFloat(ctx.custom, BUFFER, 0);
    ENGINE.gssSetBool(ctx.custom, LAUNCHED, launched);
  }
}

export class FeelFallingMode extends ENGINE.GSSFallingMode {
  public override generateMove(ctx: ENGINE.GSSMovementContext, proposals: readonly ENGINE.GSSProposedMove[]): ENGINE.GSSDesiredMove {
    const move = super.generateMove(ctx, []);
    const pressed = ctx.newInputTags.has(JUMP);
    const coyote = pressed && ENGINE.gssGetFloat(ctx.custom, AIR) <= FEEL.coyote && !ENGINE.gssGetBool(ctx.custom, JUMPED);
    if (coyote) move.velocity.y = this.jumpSpeed;
    const launched = ENGINE.gssGetBool(ctx.custom, LAUNCHED);
    if (move.velocity.y > 0 && !launched && !ctx.inputTags.has(JUMP)) {
      move.velocity.y = Math.min(move.velocity.y, this.jumpSpeed * FEEL.cut); // variable height, before effects mix
    }
    return ENGINE.mixProposedMoves(move, proposals);
  }
  public override tick(ctx: ENGINE.GSSMovementSimContext, move: ENGINE.GSSDesiredMove, dt: number): void {
    const air = ENGINE.gssGetFloat(ctx.custom, AIR) + dt;
    const usedBefore = ENGINE.gssGetInt(ctx.custom, ENGINE.JUMPS_USED_KEY);
    const pressed = ctx.newInputTags.has(JUMP);
    const coyote = pressed && ENGINE.gssGetFloat(ctx.custom, AIR) <= FEEL.coyote && !ENGINE.gssGetBool(ctx.custom, JUMPED);
    const seed = super.generateMove(ctx, []);
    if (coyote) seed.velocity.y = this.jumpSpeed;
    if (seed.velocity.y > 0 && !ENGINE.gssGetBool(ctx.custom, LAUNCHED) && !ctx.inputTags.has(JUMP)) {
      seed.velocity.y = Math.min(seed.velocity.y, this.jumpSpeed * FEEL.cut);
    }
    const launched = move.velocity.y > 0 && move.velocity.y !== seed.velocity.y;
    if (move.velocity.y < 0) { // fast fall: super.tick still adds the base gravity
      const g = ctx.target.getPhysicsEngine()?.getOptions()?.gravity.y ?? -9.81;
      move.velocity.y += g * this.characterControllerOptions.simulatedGravityScale * (FEEL.fallGravity - 1) * Math.min(dt, 0.2);
    }
    let buffer = Math.max(0, ENGINE.gssGetFloat(ctx.custom, BUFFER) - dt);
    if (pressed && !coyote && usedBefore >= this.maxMidAirJumps) buffer = FEEL.buffer;
    super.tick(ctx, move, dt);
    if (coyote) { ENGINE.gssSetInt(ctx.custom, ENGINE.JUMPS_USED_KEY, usedBefore); ENGINE.gssSetBool(ctx.custom, JUMPED, true); }
    ENGINE.gssSetFloat(ctx.custom, AIR, air);
    ENGINE.gssSetFloat(ctx.custom, BUFFER, buffer);
    if (launched) ENGINE.gssSetBool(ctx.custom, LAUNCHED, true);
  }
}
```

Register in the pawn, after `super.createGSSNode()`:

Source: .engine/src/gameplay-sim/entities/GSSCharacterPawn.ts (composed — typechecked against 18.1.0-alpha.317)
```ts
@ENGINE.GameClass()
export class PlatformHero extends ENGINE.GSSCharacterPawn {
  protected override createGSSNode(): ENGINE.GSSNode {
    const sim = super.createGSSNode();
    sim.addMovementMode(new FeelWalkingMode({ jumpSpeed: 16 }));                                            // replaces 'walking'
    sim.addMovementMode(new FeelFallingMode({ jumpSpeed: 16, maxMidAirJumps: 1, accelerationLambda: 10 })); // replaces 'falling'
    return sim;
  }
}
```

How it works: the stock walking mode jumps on the press edge and the falling mode jumps only while `jumpsUsed < maxMidAirJumps`. Both resolve that, and any effect Y, inside `generateMove`. The feel overrides change the seed first (buffer, coyote, variable-height cut), then call `mixProposedMoves`, so a launch still replaces or adds to the jump. `super.tick` adds gravity to `move.velocity.y`. The falling subclass restores `JUMPS_USED_KEY` after a coyote jump so it does not spend the double jump. Verify in Play, including one correction under latency for online games.

## Knockback and launch, classic

`PhysicsVectorParam.LinearVelocity` and impulses (`applyImpulseToPhysicsBody`) do nothing to a kinematic character (`KinematicPositionBased` capsule). Call `launch(velocity, options)` on its `CharacterMovementNode` (players and `NpcMovementNode` enemies). The velocity is in world m/s.

- `overrideHorizontal` and `overrideVertical` (default `true`) replace that part of the velocity; `false` adds to it.
- `steerLockSeconds` (default `0`): for this long, input cannot steer and a push carries against held input. The sideways push stays a world direction while the pawn turns. When the lock ends, it becomes normal forward and right speed and steering takes over. Without a lock, held input on the ground takes the push away within a frame.
- An upward launch leaves the ground like a jump, but a jump release does not cut it and it leaves no coyote jump. A second launch replaces the first and restarts the lock. `getVelocities()` includes a held push.

Source: .engine/src/nodes/movement/CharacterMovementNode.ts (`launch`, `LaunchOptions`)
```ts
/** Knock a classic character (player or NpcMovementNode enemy) away from a hit. */
export function knockback(pawn: ENGINE.MovementPawn, worldDir: THREE.Vector3, speed = 10, up = 6): void {
  const mn = pawn.movementNode;
  if (!(mn instanceof ENGINE.CharacterMovementNode)) return;
  const push = worldDir.clone().setY(0).normalize().multiplyScalar(speed).setY(up);
  mn.launch(push, { steerLockSeconds: 0.2 });
}

/** Jump pad: set the rise and keep the run speed. */
export function bounce(mn: ENGINE.CharacterMovementNode, speed = 22): void {
  mn.launch(new THREE.Vector3(0, speed, 0), { overrideHorizontal: false });
}

/** Dash along the pawn's facing, keeping the current fall. */
export function dash(pawn: ENGINE.MovementPawn, mn: ENGINE.CharacterMovementNode, speed = 18): void {
  mn.launch(pawn.forwardDirection().multiplyScalar(speed), { overrideVertical: false, steerLockSeconds: 0.15 });
}
```

Numbers: hit 8–12 m/s with a 4–6 m/s pop; heavy blow 15 m/s with 8; steering lock 0.15–0.3 s; jump pad 20–25 m/s up (apex 4–6 m). Hitstop and shake around the hit: `genesys-game-feel`. Online classic pawns: call `launch` on the authority. The server's correction carries the push and the lock, so the owning client replays them (verify in Play with two clients). For hits, set the damage event's `impulse` or a weapon's `knockback` instead (`genesys-combat`): `applyDamage` launches with a 0.2 s lock, adds the push to the current velocity, and skips hits the receiver refuses.

## Knockback and launch, GSS

Game code reaches a sim through `queueEvent`. An ability turns the event into an effect, and the effect proposes an additive horizontal push that fades over 200 ms plus a one-tick vertical launch. Walking and falling mix that Y onto the jump or the current vertical speed. The feel modes above are not required for the launch; they only keep the variable-height cut off a rising launch.

Source: .engine/src/gameplay-sim/GSSNode.ts (`queueEvent`), GSSEvent.ts, effects/GSSDashEffect.ts, types.ts (`GSSMoveMixMode`) (composed — typechecked against 18.1.0-alpha.317)
```ts
export class KnockbackEvent implements ENGINE.GSSEventPayload {
  constructor(public readonly velocity: THREE.Vector3) {} // world m/s; y > 0 launches
  public clone(): KnockbackEvent { return new KnockbackEvent(this.velocity.clone()); }
}

export class KnockbackAbility implements ENGINE.IGSSAbility {
  public readonly id = 'ability.Knockback';
  public shouldRun(_d: ENGINE.GSSTagSetView, _p: ENGINE.GSSTagSetView, _r: ENGINE.GSSTagSetView,
    _o: ENGINE.GSSTagSetView, events: ENGINE.GSSEventView): boolean { return events.has('knockback'); }
  public execute(ctx: ENGINE.GSSAbilityContext): void {
    const e = ctx.events.get<KnockbackEvent>('knockback');
    if (e) { ENGINE.gssSetVector3(ctx.custom, 'knockback.v', e.velocity); ctx.effects.apply('effect.Knockback'); }
    ctx.end();
  }
}

export class KnockbackEffect implements ENGINE.IGSSEffect {
  public readonly id = 'effect.Knockback';
  public readonly durationMs = 200;
  public proposeMove(ctx: ENGINE.GSSEffectContext): ENGINE.GSSProposedMove {
    const v = ENGINE.gssGetVector3(ctx.custom, 'knockback.v');
    const fade = Math.max(0, 1 - ctx.elapsed / this.durationMs); // horizontal push fades out
    const launchY = ctx.elapsed === 0 ? v.y : 0;                 // vertical only on the first tick
    return { velocity: new THREE.Vector3(v.x * fade, launchY, v.z * fade),
      mixMode: ENGINE.GSSMoveMixMode.Additive, mixY: ENGINE.GSSMoveMixMode.Override };
  }
}
// Register in createGSSNode(): sim.addAbility(new KnockbackAbility()); sim.addEffect(new KnockbackEffect());
// Hit code: target.getGSSNode().queueEvent('knockback', new KnockbackEvent(dir.multiplyScalar(10).setY(6)));
```

The proposed velocity is the target the mode damps toward, so on the ground (lambda 10 without input, 100 with it) the push reads as a shove, and in the air (5 / 0.5) it carries. An ability on the attacker's own sim can apply the effect directly with `ctx.world.applyEffect(target, 'effect.Knockback')`; the direction then has to travel as a `GSSEffectPayload`, a replicated net class, so the event route above is simpler for game code. `queueEvent` is ignored on simulated proxies; in an online game call it where the hit is decided (server) and let the correction reach the owner (verify in Play with two clients). A GSS actor with no modes discards proposed movement: register `GSSIdleMode`.
