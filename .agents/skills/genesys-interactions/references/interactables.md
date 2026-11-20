# Interactables

Source: `.engine/src/nodes/gameplay/`. Start with `index.ts`, then open the file for the node you need.

## How the pieces compose

- **Player side.** `GameplayPawn.ts` and `DefaultCharacterPawn.ts` live in `.engine/src/entities/` (a sibling of `nodes/gameplay/`, not nested under it). They auto-create an `InteractionNode` in `beginPlay` and expose `interact()` / `endInteract()` for a `PlayerController` to call. Both implement `IInteractPawn` (`interact`, `endInteract`, `getInteractionNode`), checked with `isInteractPawn(pawn)`. Base `Pawn`, `MovementPawn`, and `CharacterPawn` do not. `DefaultPlayerController` maps `E` to `interact()` on press and `endInteract()` on release.
- **Interactable contract** (`IInteractable.ts`): `beginInteract(player)`, optional `endInteract(player)` (hold-to-interact), `canInteract(player)`, `getInteractionPrompt()`, `getInteractionPriority()`, `getWorldPosition()`. `isInteractable(obj)` is the type guard. Anything can implement it; the built-ins use the proximity base. Player parameters are `SceneNode`.
- **Proximity base** (`ProximityInteractableNode.ts`): abstract. Detects players in range, registers itself with the player's `InteractionNode`, and supports key-press or automatic proximity activation. Extend it for custom levers, NPCs, chests, and terminals.
- **Hub** (`InteractionNode.ts`): lives on the player pawn. Holds registered interactables (as `WeakRef`s) and selects by `canInteract`, then priority (higher first), then distance (closer first).

These compose: a keyed door extends `DoorNode`, a coin subclasses `PickupNode`, a level exit uses `TriggerZoneNode`, and a custom crate implements `IInteractable` or extends `ProximityInteractableNode`. Repeated pickups or doors that share an authored hierarchy should be Prefabs (`genesys-prefabs`), not copy-pasted node trees.

## A GSS hero that interacts

The short version is in [SKILL.md → Player side](../SKILL.md#player-side). `GameplayPawn` and `DefaultCharacterPawn` auto-create an `InteractionNode` in `beginPlay` and expose `interact()` / `endInteract()`. `DefaultPlayerController` calls them on `E`. No code needed. Base `Pawn`, `MovementPawn`, `CharacterPawn` and `GSSCharacterPawn` do not do this. Interactables register only with a pawn that passes `isInteractPawn` (`interact`, `endInteract`, `getInteractionNode`), and `GSSPlayerController` has no E key. A GSS hero needs both halves:

Source: .engine/src/entities/DefaultCharacterPawn.ts, .engine/src/entities/PawnActions.ts, .engine/src/gameplay-sim/entities/GSSPlayerController.ts
```ts
@ENGINE.GameClass()
export class InteractingGSSHero extends ENGINE.GSSCharacterPawn implements ENGINE.IInteractPawn {
  public override beginPlay(): boolean {
    if (!super.beginPlay()) return false;
    if (!this.getNode(ENGINE.InteractionNode)) this.add(ENGINE.InteractionNode.create({}));
    return true;
  }
  public interact(): boolean { return this.getInteractionNode()?.beginInteract() ?? false; }
  public endInteract(): void { this.getInteractionNode()?.endInteract(); }
  public getInteractionNode(): ENGINE.InteractionNode | null { return this.getNode(ENGINE.InteractionNode); }
}

@ENGINE.GameClass()
export class InteractingGSSController extends ENGINE.GSSPlayerController {
  public override handleKeyDown(e: KeyboardEvent): boolean {
    const pawn = this.getPawn();
    if (e.code === 'KeyE' && ENGINE.isInteractPawn(pawn)) { pawn.interact(); return true; }
    return super.handleKeyDown(e);
  }
  public override handleKeyUp(e: KeyboardEvent): boolean {
    const pawn = this.getPawn();
    if (e.code === 'KeyE' && ENGINE.isInteractPawn(pawn)) { pawn.endInteract(); return true; }
    return super.handleKeyUp(e);
  }
}
```
Online, the interact runs on the client for the prompt; the state change (door open) goes to the server (`genesys-multiplayer`).

## `InteractionNode`

| Method | Does |
|---|---|
| `beginInteract()` | Cleans dead refs, selects the best target, and calls its `beginInteract(player)` if `canInteract`. Returns whether it started. |
| `endInteract()` | Calls `endInteract(player)` on the current target, if it has one. |
| `register(i)` / `unregister(i)` | Called by interactables as players enter and leave range. |
| `getCurrentPrompt()` | Prompt of the best available target, or `''`. Poll it for the HUD. |
| `hasAvailableInteractable()` | Any target with `canInteract` true. |
| `getCurrentInteractable()`, `getRegisteredInteractables()` | Inspection. |

## `ProximityInteractableNode`

Options: `proximityRange` (default `2.0`, min 0.5), `useKeyPressInteraction` (default `true`; `false` = automatic on proximity, no registration with the hub).

Detection:
- If the root already has a `CollisionShapeNode`, it binds that shape's `onOverlapWith` / `onStopOverlappingWith`.
- Otherwise it creates a transient root with a `CollisionShapeNode` box trigger (`Static`, `Trigger` profile, collision events) scaled `proximityRange × 2` wide, `2.5` tall, `proximityRange × 2` deep, positioned by `calculateTriggerPosition()` (root position + 1.25 up; override to move it).
- A "player" is any root where `isPlayerControlled()` is true (`isPlayerPawn`, overridable).

Hooks to override: `onPlayerEntered(player)`, `onPlayerLeft(player)`, `onFirstPlayerEntered()`, `onLastPlayerLeft()`. Delegates: `onPlayerEnteredRange`, `onPlayerLeftRange`. Queries: `hasPlayersInRange()`, `getPlayerCountInRange()`, `getPlayersInRange()`, `isPlayerInRange(player)`.

Abstract methods you implement: `beginInteract`, `canInteract`, `getInteractionPrompt`, `getInteractionPriority`.

## `DoorNode`

| Option | Default | Notes |
|---|---|---|
| `doorType` | `DoorType.Hinged` | `Hinged` (Y rotation), `Sliding` (along `slideDirection`), `Garage` (rotate and lift, basic), `Double` (placeholder, uses hinged), `Custom` (you animate from delegates) |
| `interactionType` | `DoorInteractionType.Proximity` | `Proximity` auto-opens on first player in range and closes when the last leaves. `KeyPress` needs E. `Remote` opens only from code (a switch, trigger or script). |
| `animationDuration` | `1.0` s | |
| `maxOpenAngle` | `90`° | Hinged |
| `slideDistance` | `2.0` | Sliding |
| `slideDirection` | `(1, 0, 0)` | Sliding, in the door actor's (root's) space |
| `startLocked` | `false` | |
| `startOpen` | `false` | Starts open |
| `requiredKey` | `''` | A locked door unlocks and opens for a player holding this key (`IKeyHolder`) |
| `target` | `null` | Node the door moves; empty moves the first `ModelMeshNode` under the root |

Methods: `open()` (a locked door raises `onOpenRefused` instead; can reverse a closing animation), `close()`, `toggle()`, `lock()`, `unlock()`, `isOpen()`, `isLocked()`, `isAnimating()`, `getState()` (`DoorState`: `Closed`, `Opening`, `Open`, `Closing`, `Locked`).

Set the state without animating: `open({ instant: true })` and `close({ instant: true })` jump to the end and raise only `onDoorOpened` or `onDoorClosed`. `reset()` puts the door back as it started (`startOpen`, `startLocked`) instantly, for a checkpoint or puzzle reset. A position set before play shows once the door sets up its target.

Delegates: `onDoorStartOpening`, `onDoorStartClosing`, `onDoorOpened`, `onDoorClosed`, `onDoorLocked`, `onDoorUnlocked`, `onOpenRefused`, `onInteractionAttempt`. `onDoorLocked` fires when the door gets locked; `onOpenRefused` fires when an open is refused because the door is locked: `open()` from code, or a player without its key interacting (or walking up to a `Proximity` door).

Interaction: `canInteract` = in range **and** `KeyPress` mode, locked or not, so a locked door shows `'Locked'` (`'Unlock'` while a player in range holds its key; otherwise `'Open Door'`). Priority `100`. On a locked door, the interact key raises `onInteractionAttempt`, then opens with the player's key or raises `onOpenRefused` and stays shut. A locked `Proximity` door opens when a key holder walks up and raises `onOpenRefused` for anyone else.

Mesh: the door moves its `target`, or else the first `ModelMeshNode` under its root (waiting for the model to load); any node works, including primitive meshes. It scores the meshes under that node by name (`door`, `panel`, `leaf`) and tall shape to find the panel. A hinged door turns about the panel's minimum-X edge and a garage door about its top edge (without a panel, about the node's origin). It animates the node's transform relative to its initial pose, and a static or kinematic body on that node moves with it. The proximity trigger is centred on the panel.

**Keyed door.** Set `requiredKey` and `startLocked: true`, and give whatever carries keys `ENGINE.IKeyHolder`: `hasKey(keyId)`, and optionally `useKey(keyId)`, which runs once when a door unlocks with the key (remove the key there to make it single-use). The door asks the interacting player node, the nodes above it, then its pawn's controller (`ENGINE.findKeyHolder`). Play the rattle on `onOpenRefused`. For a custom prompt (`'Locked — needs Red Key'`), subclass `DoorNode` and override `getInteractionPrompt()`.

Source: `.engine/src/nodes/gameplay/KeyHolder.ts`, `.engine/src/nodes/gameplay/DoorNode.ts`
```ts
@ENGINE.GameClass()
export class HeroController extends ENGINE.PlayerController implements ENGINE.IKeyHolder {
  private readonly keys = new Set<string>();
  public addKey(keyId: string): void { this.keys.add(keyId); }
  public hasKey(keyId: string): boolean { return this.keys.has(keyId); }
}

const vault = ENGINE.DoorNode.create({
  interactionType: ENGINE.DoorInteractionType.KeyPress, startLocked: true, requiredKey: 'red',
});
vault.onOpenRefused.add(() => { /* rattle sound, 'Needs the red key' toast */ });
```

## `SwitchNode`

| Option | Default | Notes |
|---|---|---|
| `switchType` | `SwitchType.Toggle` | `Toggle` (on/off by E), `Proximity` (on while a player is in range; no key press), `Button` (fires `onPressed` every press, no state) |
| `initialState` | `SwitchState.Off` | |
| `proximityRange`, `useKeyPressInteraction` | from the base | `useKeyPressInteraction` is set from the type (`false` only for `Proximity`) |

Methods: `activate()`, `deactivate()`, `toggle()`, `isActive()`, `getState()`, `getSwitchType()`, `enableInteraction()`, `disableInteraction()`, `isInteractionEnabled()`.

Delegates: `onActivated`, `onDeactivated`, `onPressed` (Button), `onInteractionAttempt`.

Prompts: Toggle `'Press E to Turn On'` / `'Press E to Turn Off'`, Button `'Press E to Activate'`, Proximity `''`. Priority `80` (below doors). Override `getInteractionPrompt()` when the game uses a different key or touch (`genesys-touch-controls`).

**Wiring**: switches do not know their targets. Connect them in a `GAME` subclass, or in the GameMode after the level loads, by finding nodes by name: `lever.onActivated.add(() => door.open())`. Puzzle logic (all three plates down → gate opens) lives in one small controller node that listens to each switch.

## Custom interactables

Extend `ProximityInteractableNode`:

Source: .engine/src/nodes/gameplay/ProximityInteractableNode.ts, SwitchNode.ts
```ts
@ENGINE.GameClass()
export class Chest extends ENGINE.ProximityInteractableNode {
  public readonly onOpened = new ENGINE.Delegate<[ENGINE.SceneNode]>();
  private opened = false;

  public beginInteract(player: ENGINE.SceneNode): boolean {
    if (!this.canInteract(player)) return false;
    this.opened = true;
    this.onOpened.invoke(player);                      // play lid tween, sound, loot
    return true;
  }
  public canInteract(player: ENGINE.SceneNode): boolean {
    return !this.opened && this.isPlayerInRange(player);
  }
  public getInteractionPrompt(): string { return 'Open chest'; }
  public getInteractionPriority(): number { return 60; }
}
```

 Priorities: doors 100, switches 80, so pick 50–90 for chests, terminals, and NPCs, and above 100 only for something that must win (a revive prompt). For hold-to-interact (charge a terminal, revive), implement `endInteract(player)` and track hold time on game time; show progress on a meter (`genesys-ui`).

NPC talk: a `ProximityInteractableNode` on the NPC root with prompt `'Talk'`. `beginInteract` opens the dialogue UI and returns true. Dialogue text from players or the network goes through text setters only.

## Multiplayer

Interaction state (door open, switch on, pickup taken) must change on the authority and replicate. The proximity and prompt logic runs per client for the local player. See `genesys-multiplayer`.

## Traps

- Locked door shows no prompt → its `interactionType` is `Proximity`, which never prompts (it opens by itself for a holder of its `requiredKey`) → use `KeyPress` when the player should see the lock.
- A `KeyPress` door never opens on E → default `interactionType` is `Proximity` (auto-open), and `canInteract` is true only for `KeyPress` → set `interactionType: ENGINE.DoorInteractionType.KeyPress`.
- Door does not move, or the frame swings instead of the panel → it moves its `target`, else the first `ModelMeshNode` under the root (it warns "No target and no ModelMeshNode" when there is none) → set `target` to the panel node; or use `DoorType.Custom` and animate from `onDoorStartOpening` / `onDoorStartClosing`.
- The locked rattle plays when code locks a door, or never plays → it is on `onDoorLocked`, which fires on `lock()` → play it on `onOpenRefused`.
