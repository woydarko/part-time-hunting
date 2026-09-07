/**
 * ShopkeeperInteractable - a "Press E to shop" interactable whose interaction zone is a box volume
 * (the ShopArea cube) rather than a proximity sphere. The player can open the shop only while
 * inside that box; outside it the prompt hides and E does nothing.
 *
 * Add it as a child of the shopkeeper model node (alongside its AnimationStateMachineNode and
 * NpcIdleController). It finds the zone node by name (`areaNodeName`, default "ShopArea") anywhere
 * in the scene. On interact it: plays the `Interact` greeting via the sibling NpcIdleController,
 * turns the NPC to face the player, and opens the shop UI on the player pawn (duck-typed
 * `openShop()` so this node stays decoupled from the pawn class).
 */

import * as THREE from 'three';

import * as ENGINE from '@gnsx/genesys.js';

import { NpcIdleController } from './NpcIdleController.js';

const INTERACT_GESTURE = 4; // matches the `interact` state in Rogue.animconfig.json

@ENGINE.GameClass()
export class ShopkeeperInteractable extends ENGINE.ProximityInteractableNode {
  /** Prompt text shown when the player is inside the zone. */
  @ENGINE.property()
  public promptText = 'Press E to shop';

  /** Which menu to open on interact: 'shop' (grid) or 'gear' (Ranger category carousel). */
  @ENGINE.property()
  public menuKind = 'shop';

  /** How long the greeting gesture holds before returning to idle. */
  @ENGINE.property()
  public greetHold = 1.5;

  /**
   * Yaw offset (degrees) added when the NPC turns to face the player on interact. Default 0 (Rogue).
   * Set 180 for an NPC placed facing the opposite way (e.g. the Ranger faces the Rogue) so it doesn't
   * end up showing its back.
   */
  @ENGINE.property()
  public faceYawOffsetDeg = 0;

  /** Name of the box node that defines the interaction zone. */
  @ENGINE.property()
  public areaNodeName = 'ShopArea';

  /** Floating icon above the NPC's head — height + size (world units, NPC-local). */
  @ENGINE.property()
  public iconHeight = 2.8;
  @ENGINE.property()
  public iconScale = 0.9;

  private iconSprite: THREE.Sprite | null = null;
  private iconTime = 0;

  // --- Shop "trade shot" camera framing (tune in the inspector). ---
  /**
   * Name of a marker node that sets the shop camera POSITION. Drag it in the editor to place the
   * camera; it auto-looks at the shopkeeper. Leave empty (or delete the node) to use camDistance/
   * camHeight instead.
   */
  @ENGINE.property()
  public camNodeName = 'ShopCam';

  /** Distance from the shopkeeper to the camera (used only when no camNode marker exists). */
  @ENGINE.property()
  public camDistance = 2.4;

  /** Camera height above the focus point (lower = more eye-level). */
  @ENGINE.property()
  public camHeight = 0.25;

  /** Focus-point height on the shopkeeper (~chest). */
  @ENGINE.property()
  public camFocusHeight = 1.1;

  /** Yaw offset in degrees so the shopkeeper sits on the right (flip sign to mirror). */
  @ENGINE.property()
  public camFrameYaw = -22;

  /** Pitch (tilt) offset in degrees. Positive tilts up, negative tilts down. */
  @ENGINE.property()
  public camFramePitch = 0;

  /** Camera swing responsiveness (higher = snappier). */
  @ENGINE.property()
  public camLerp = 9;

  private area: ENGINE.SceneNode | null = null;
  private readonly tmpPos = new THREE.Vector3();
  private readonly invMatrix = new THREE.Matrix4();

  public override beginPlay(): boolean {
    if (!super.beginPlay()) return false;
    this.area = (this.getWorld()?.getNodeByName(this.areaNodeName) as ENGINE.SceneNode | null) ?? null;
    if (!this.area) {
      console.warn(`ShopkeeperInteractable: zone node "${this.areaNodeName}" not found — interaction disabled.`);
    }
    this.buildIcon();
    return true;
  }

  /** Floating yellow billboard icon over the NPC's head: a sword for the gear shop, a bag for sell. */
  private buildIcon(): void {
    const path = this.menuKind === 'gear'
      ? '@project/assets/textures/sword.png'
      : '@project/assets/textures/shop.png';
    const mat = new THREE.SpriteMaterial({ color: 0xffe23a, transparent: true, toneMapped: false, depthTest: true });
    Promise.resolve(ENGINE.resourceManager.loadTexture(ENGINE.AssetPath.fromString(path))).then((tex) => {
      if (tex) { mat.map = tex as THREE.Texture; mat.needsUpdate = true; }
    }).catch(() => { /* keep the flat colour if the icon can't load */ });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(this.iconScale, this.iconScale, 1);
    sprite.position.set(0, this.iconHeight, 0);
    this.add(sprite);
    this.iconSprite = sprite;
  }

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime); // base drives the proximity check
    if (this.iconSprite) {
      this.iconTime += deltaTime;
      this.iconSprite.position.y = this.iconHeight + Math.sin(this.iconTime * 2) * 0.12; // gentle bob
    }
  }

  // The zone is a box, not a sphere — skip the base's distance/trigger proximity setup and drive
  // range purely from box containment in updateProximityCheck below.
  protected override setupProximityDetection(): void {
    /* intentionally empty */
  }

  protected override updateProximityCheck(): void {
    const world = this.getWorld();
    if (!world || !this.area) return;
    const players = world.getNodes(ENGINE.Pawn).filter((p) => this.isPlayerPawn(p));
    for (const player of players) {
      const inside = this.isInsideArea(player);
      const wasInside = this.playersInRange.has(player);
      if (inside && !wasInside) this.handlePlayerEnteredRange(player);
      else if (!inside && wasInside) this.handlePlayerLeftRange(player);
    }
  }

  /** True when the player's world position is inside the ShopArea box (OBB — handles rotation/scale). */
  private isInsideArea(player: ENGINE.SceneNode): boolean {
    if (!this.area) return false;
    this.area.updateWorldMatrix(true, false);
    this.invMatrix.copy(this.area.matrixWorld).invert();
    const local = player.getWorldPosition(this.tmpPos).applyMatrix4(this.invMatrix);
    // Unit BoxGeometry spans [-0.5, 0.5] in local space; the matrix carries the node's scale.
    return Math.abs(local.x) <= 0.5 && Math.abs(local.y) <= 0.5 && Math.abs(local.z) <= 0.5;
  }

  //===========================================================================
  // IInteractable
  //===========================================================================

  public override getInteractionPrompt(): string {
    return this.promptText;
  }

  public override getInteractionPriority(): number {
    return 0;
  }

  public override canInteract(player: ENGINE.SceneNode): boolean {
    return this.isInsideArea(player);
  }

  public override beginInteract(player: ENGINE.SceneNode): boolean {
    const idle =
      this.parent?.getNode(NpcIdleController) ?? this.getRoot()?.getNode(NpcIdleController) ?? null;
    idle?.forceGesture(INTERACT_GESTURE, this.greetHold);

    this.faceTarget(player);

    const shopper = player as unknown as {
      openShop?: (npc: ENGINE.SceneNode) => void;
      openGearShop?: (npc: ENGINE.SceneNode) => void;
    };
    if (this.menuKind === 'gear') shopper.openGearShop?.(this);
    else shopper.openShop?.(this);
    return true;
  }

  /** Turn the NPC (this node's parent) to face the player horizontally. */
  private faceTarget(target: ENGINE.SceneNode): void {
    const npc = this.parent;
    if (!(npc instanceof ENGINE.SceneNode)) return;
    const a = npc.getWorldPosition(new THREE.Vector3());
    const b = target.getWorldPosition(new THREE.Vector3());
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    if (dx * dx + dz * dz < 1e-6) return;
    // Reset X/Z to 0 as well: some models import with an X=π,Z=π base rotation (a mirror) that,
    // if left in place while only Y is set, flips the left/right facing. A clean upright Y yaw fixes it.
    npc.rotation.set(0, Math.atan2(dx, dz) + THREE.MathUtils.degToRad(this.faceYawOffsetDeg), 0);
  }
}
