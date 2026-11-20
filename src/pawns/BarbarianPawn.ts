/**
 * BarbarianPawn - a playable third-person character (KayKit Barbarian + Rig_Medium anims).
 *
 * Custom locomotion / camera on top of DefaultCharacterPawn:
 *  1. Feet planted on the ground (visual mesh offset to the capsule bottom).
 *  2. Orient-to-movement: WASD is interpreted relative to the camera. The character
 *     quickly pivots to face the desired direction, THEN runs forward (so pressing
 *     back spins 180 first, strafing spins 90 first). Always plays the forward run clip.
 *  3. Camera yaw is fixed in the world and only changes while the right mouse button is
 *     held (free-look). Otherwise the camera keeps its orientation no matter where the
 *     character runs; it only tracks the character's position.
 *
 * We keep the default DefaultPlayerController (jump, pointer-lock, gamepad, wheel-zoom)
 * and customize purely by overriding the pawn methods the controller drives.
 */

import * as THREE from 'three';

import * as ENGINE from '@gnsx/genesys.js';

import { WaterNode } from '../nodes/WaterNode.js';
import { WildAnimal } from '../animals/WildAnimal.js';
import { LootDrop } from '../nodes/LootDrop.js';
import { DROP_ITEMS, type DropItem } from '../data/animals.js';
import { WEAPONS, ARROW, ARROW_ITEM, BAREHAND_DAMAGE, type WeaponDef, type RangedStats } from '../data/weapons.js';
import { POTIONS, POTION_GRIP, type PotionEffect } from '../data/potions.js';
import { ArrowProjectile } from '../nodes/ArrowProjectile.js';
import { TrajectoryPreview } from '../nodes/TrajectoryPreview.js';
import { Inventory } from '../systems/Inventory.js';
import { saveProgress, loadProgress } from '../systems/SaveGame.js';
import { BackpackUI } from '../ui/BackpackUI.js';
import { FadeOverlay } from '../ui/FadeOverlay.js';
import { GearShopUI, type GearItem, type BuyResult } from '../ui/GearShopUI.js';
import { GoldHUD } from '../ui/GoldHUD.js';
import { HealthBar } from '../ui/HealthBar.js';
import { ChargeBar } from '../ui/ChargeBar.js';
import { StatusHUD, type StatusRow } from '../ui/StatusHUD.js';
import { installGameFont } from '../ui/gameFont.js';
import { Hotbar } from '../ui/Hotbar.js';
import { InteractPrompt } from '../ui/InteractPrompt.js';
import { Crosshair } from '../ui/Crosshair.js';
import { WeaponTuner, type WeaponTune } from '../ui/WeaponTuner.js';
import { ShopUI } from '../ui/ShopUI.js';
import { PauseMenu } from '../ui/PauseMenu.js';
import { FadingText } from '../ui/FadingText.js';
import { LoadingScreen } from '../ui/LoadingScreen.js';
import { preloadGameAssets } from '../systems/preloadGameAssets.js';
import { getSettings } from '../systems/GameSettings.js';
import { isAuthority, isOnline } from '../systems/Net.js';
import { StoreRewards, type StoreRewardTarget } from '../systems/StoreRewards.js';
import {
  CHARM_DURATION_MS, CHARM_SELL_MULT, GOLD_POUCH_AMOUNT, QUIVER_ARROWS, SATCHEL_BACKPACK_SIZE,
  SKU_GOLD_POUCH, SKU_MERCHANT_CHARM, SKU_POTION_KIT, SKU_QUIVER, SKU_SATCHEL,
} from '../data/storeItems.js';
import { Sfx } from '../systems/Sfx.js';
import { RUN_DUST, BURST_DUST, DASH_DUST } from '../vfx/DustVfx.js';
import { WeaponTrailNode } from '../vfx/WeaponTrailNode.js';
import { MENU_SCENE_URL } from '../data/scenes.js';

/** Target size + palm offset/rotation for a model held in the hand socket (potions, loot). */
type HeldGrip = { size: number; offsetPos: readonly [number, number, number]; offsetRot: readonly [number, number, number] };
/** Generic grip for held loot — auto-normalized to this world height; tune per-item later if needed. */
const LOOT_GRIP: HeldGrip = { size: 0.22, offsetPos: [0, 0, 0], offsetRot: [0, 0, 0] };

// Overall character size relative to the world (1 = engine default 1.8m capsule). Lowering this
// shrinks the whole pawn AND every world-unit quantity derived from it (speeds, jump, dash,
// dust, trail) so the character stays self-consistent at any size. Single knob — tune freely.
const CHARACTER_SCALE: number = 0.15;

const BARBARIAN_MODEL_URL = '@project/assets/models/Barbarian.glb';
const BARBARIAN_MATERIAL_URL = '@project/assets/materials/M_BarbarianBody.material.json';
const BARBARIAN_ANIM_CONFIG_URL = '@project/assets/animations/Barbarian.animconfig.json';

// Right-hand weapon socket bone in the KayKit Rig_Medium skeleton.
const HAND_BONE = 'handslotr';
const SOCKET_NAME = 'RightHand';
const HAND_BONE_L = 'handslotl';
const SOCKET_NAME_L = 'LeftHand';
// How long the trail captures per swing before it starts fading (shorter than the swing so
// the tail is already dissolving as the attack animation finishes).
const TRAIL_CAPTURE_TIME = 0.32;
// Dagger placement in the hand socket — tune if the grip looks off. Size comes from the prefab.
const DAGGER_OFFSET_POS = new THREE.Vector3(0, 0, 0);
const DAGGER_OFFSET_ROT = new THREE.Euler(0, 0, 0);

// Attack lunge: a small forward step in the facing direction on each swing (~0.3m).
const LUNGE_INPUT = 0.6;     // forward input strength at the start of the lunge (0-1)
const LUNGE_DURATION = 0.18; // seconds the lunge decays over
// Minimum gap between combo swings so clips aren't instantly cut off by spam.
const ATTACK_MIN_GAP = 0.42; // seconds — slower swing cadence so melee can't be spam-dumped
// Melee reach (world units, added on top of each animal's hit radius). Damage comes from the
// equipped weapon (or BAREHAND_DAMAGE). Frontal only: target must be roughly ahead of the pawn.
const MELEE_REACH = 2.0;
const STORE_KEY = 'KeyT';   // opens the Silicon store
const LOOT_PICKUP_RANGE = 0.55; // player must be this close (world units) to pick up a loot drop
// Timed potion effects.
const SPEED_DURATION = 60;  // blue: +40% move speed for this many seconds
const DAMAGE_DURATION = 30; // red: 2x damage
const HEAL_DURATION = 10;   // green: heal-over-time window
const HEAL_RATE = 3;        // HP per second while healing (3/s * 10s = 30 HP)
const MELEE_FRONT_DOT = 0.2; // cos threshold — target must be within ~78 deg of forward
// Delay from the swing start to the "strike" frame where the blade actually connects. The hit is
// applied then (once per swing) instead of on click, so mashing the button can't out-pace the swing.
const MELEE_STRIKE_DELAY = 0.22;
// Movement is 30% slower while aiming (heavier, more deliberate strafing).
const AIM_SPEED_MULT = 0.7;
// Arrow economy on: arrows are consumed per shot and must be bought/kept in the backpack.
const UNLIMITED_ARROWS = false;
// Knockback when an animal attack lands: a short, fast velocity burst away from the attacker.
const KNOCKBACK_SPEED = 100 * CHARACTER_SCALE; // launch velocity — higher = faster AND farther
const KNOCKBACK_DURATION = 0.4;

// Potion drink timing. The Use_Item clip is stretched to DRINK_TOTAL seconds (native ~1.6s), the
// effect fires at the gulp, and the bottle is put away when the clip ends.
const DRINK_TOTAL = 3.0;
const DRINK_EFFECT_TIME = 1.9;          // ~gulp moment within the 3s gesture
const DRINK_CLIP_SPEED = 1.6 / DRINK_TOTAL; // slow Use_Item (native ~1.6s) to last DRINK_TOTAL

// Dodge roll (Shift + direction). Grounded only.
const DODGE_STATES = new Set(['dodge_f', 'dodge_b', 'dodge_l', 'dodge_r']);
const DASH_KEY = 'KeyQ';                          // tap Q to dash
const SPRINT_KEYS = ['ShiftLeft', 'ShiftRight'];  // hold Shift to sprint
const DASH_SPEED = 13.3 * CHARACTER_SCALE; // dash velocity m/s (scaled to pawn size so the dash covers a proportional distance)
const DODGE_DURATION = 0.6;   // seconds the burst decays over (0.5*speed*duration ~= distance)
const DODGE_COOLDOWN = 0.6;   // seconds between rolls
// Sprint: hold Shift to run faster (the same key taps into a dash). Multiplies the current max speed.
const SPRINT_MULT = 1.5;
// Dodge clip is 0.4s; stretch it to match DODGE_DURATION so the animation and the dash
// burst end together (velocity ~0 at exit = no clamp jitter / position snap).
const DODGE_CLIP_SPEED = 0.4 / 0.6;
const IFRAME_START = 0.12;    // invincibility window start (s into the roll)
const IFRAME_END = 0.45;      // invincibility window end

// Foot dust VFX.
const DUST_MIN_SPEED = 1.5 * CHARACTER_SCALE; // planar speed (m/s) above which running dust emits (scaled: the pawn's max speed shrank too)
const FEET_OFFSET_Y = -0.9;   // feet relative to pawn origin (capsule bottom = -CHARACTER_HALF_HEIGHT)

const HOTBAR_SLOT_COUNT = 4;

// Base animation states in which the character is mid-attack (movement is locked / lunging).
// d_* = 1H set (dagger/blade), h_* = 2H set (axe), u_* = unarmed.
const ATTACK_STATES = new Set([
  'd_atk1', 'd_atk2', 'd_atk3', 'd_atk4', 'd_jump',
  'h_atk1', 'h_atk2', 'h_atk3', 'h_atk4',
  'u_atk1', 'u_atk2',
]);
// Ranged aim/shoot now live on the masked upper-body layer (not the base graph), so the base state
// is plain locomotion while aiming — aim detection uses the `this.aiming` flag instead.
const COMBO_MAX_ARMED = 4;   // 1H: Stab->Slice_H->Slice_D->Chop | 2H: Stab->Slice->Spin->Chop
const COMBO_MAX_UNARMED = 2; // barehand: Punch -> Kick

/**
 * Deep-copy a VFX definition and scale every spatial magnitude (spawn offsets, particle
 * size, speed, gravity) by `f`. VFX particles simulate in world space and do NOT inherit
 * the pawn's node scale, so foot dust must be scaled explicitly to match the shrunk pawn.
 */
 
function scaledVfx(def: any, f: number): any {
  const d = structuredClone(def);
  for (const p of d.particles ?? []) {
    if (Array.isArray(p.gravity)) p.gravity = p.gravity.map((v: number) => v * f);
  }
  for (const e of d.emitters ?? []) {
    for (const k of ['startPositionMin', 'startPositionMax', 'size', 'speed']) {
      if (Array.isArray(e[k])) e[k] = e[k].map((v: number) => v * f);
    }
  }
  return d;
}

// KayKit Barbarian mesh: feet at localY ~= -0.081, top ~= 1.394 (height ~1.475) at scale 1.
const MODEL_SCALE = 1.22;
const MODEL_MIN_Y = -0.081;
const CHARACTER_HALF_HEIGHT = 0.9; // CHARACTER_HEIGHT (1.8) / 2 — capsule bottom relative to pawn origin.
// Extra downward nudge so the feet visually plant on the ground (accounts for the physics
// capsule's contact/skin gap that leaves the mathematical bottom slightly above the floor).
const FOOT_PLANT_OFFSET = 0.12;
// Place feet on the ground: capsule bottom - model feet offset - plant nudge.
const MESH_Y = -CHARACTER_HALF_HEIGHT - MODEL_MIN_Y * MODEL_SCALE - FOOT_PLANT_OFFSET;

// How fast the character pivots toward the desired heading (rad/s). High = snappy pivot.
const TURN_RATE = 14;
const AIM_TURN_RATE = 18; // faster snap-to-camera facing while aiming a ranged weapon
// Fixed over-the-shoulder framing while aiming (pawn-local units, INDEPENDENT of the scroll zoom, so
// aiming always frames the same tight shot no matter how far the player scrolled). Tune these three.
const AIM_ARM = 4.0;        // spring-arm length while aiming — small = camera close behind the head
const AIM_SHOULDER = 1.5;   // camera offset to the right (over the right shoulder)
const AIM_RAISE = 0.6;      // camera offset up (toward head height)
const TPS_UP_RAISE = 1.6;    // normal-TPS pivot lift when looking up (keeps the arm from swinging through the body)
const AIM_PIVOT_RAISE = 2.0; // extra pivot lift while aiming when looking up
const CAM_GROUND_MARGIN = 0.06; // world-space clearance the camera keeps above the ground
const AIM_BLEND_RATE = 12;  // how fast the aim camera eases in/out
// Torso aim-bend: how much of the camera pitch the spine/chest follow while aiming (legs stay put).
const SPINE_PITCH_FACTOR = 0.55;
const CHEST_PITCH_FACTOR = 0.30;
// Clamp the pitch fed into the bend so the spine can't over-rotate / spin at steep look angles.
const TORSO_PITCH_LIMIT = 0.6; // radians (~34 degrees) up and down
// While the heading is misaligned the character barely moves (pivot first); it accelerates
// as it aligns. `align` is cos(angleToTarget): 1 = facing target, -1 = opposite.
const ALIGN_MIN = 0.3; // below this alignment -> no forward movement (pure pivot)
// Free-look sensitivity multiplier applied to the mouse look deltas while RMB is held.
const FREE_LOOK_SENS = 0.3;
// Flip horizontal / vertical free-look direction if it feels inverted.
const INVERT_FREE_LOOK_YAW = true;
const INVERT_FREE_LOOK_PITCH = false;

// Water is deadly: the pawn dies the instant its body dips this far below the water surface,
// then respawns at the last safe ground position after a short black fade.
const WATER_DEATH_DEPTH = 0.03;
const MAX_HEALTH = 100;
// Respawn offset: step the respawn point back inland (opposite the direction the pawn was moving
// when it last stood safely) so it never spawns right on the water's edge and instantly dies again.
const RESPAWN_BACK_OFFSET = 1.0; // world units back along the entry direction
const RESPAWN_Y_OFFSET = 0.4;    // drop in from slightly above so the controller settles onto ground

// Shop camera framing: on interact the camera swings to a fixed "trade shot" — the shopkeeper is
// framed on the right of the screen and the shop UI is anchored on the left. All world units.
const SHOP_CAM_DIST = 2.4;         // distance from the shopkeeper to the camera
const SHOP_CAM_HEIGHT = 0.8;       // camera height above the focus point
const SHOP_CAM_FOCUS_HEIGHT = 1.1; // focus point height on the shopkeeper (~chest)
const SHOP_CAM_FRAME_YAW = -22;    // degrees to yaw the camera so the shopkeeper sits on the right (flip sign to mirror)
const SHOP_CAM_LERP = 9;           // camera move responsiveness (higher = snappier)
const ONE_SCALE = new THREE.Vector3(1, 1, 1); // shared unit scale for matrix compose

// Key that plays the pickup animation.
const PICKUP_KEY = 'KeyF';
// Playback speed multiplier for the pickup clip (>1 = faster).
const PICKUP_SPEED = 1.6;

/** Shortest signed angular difference from `a` to `b`, in (-PI, PI]. */
function shortestAngle(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Highest damage a single hit may claim (strongest weapon with a damage potion), for server checks. */
function maxHitDamage(): number {
  let best = Math.max(BAREHAND_DAMAGE, ARROW.damage);
  for (const w of Object.values(WEAPONS)) best = Math.max(best, w.damage ?? 0);
  return best * 2;
}

@ENGINE.GameClass()
export class BarbarianPawn extends ENGINE.DefaultCharacterPawn implements StoreRewardTarget {

  // ---- co-op replicated state: written on the server, shown on the OTHER players' screens ----
  /** Weapon in hand ('' = bare hands). */
  @ENGINE.property({ replicate: true, transient: true, net: { netType: 'string', replicateTo: 'non-owner' } })
  public netEquippedId: string = '';
  /** Aiming a ranged weapon (upper-body aim pose). */
  @ENGINE.property({ replicate: true, transient: true, net: { netType: 'bool', replicateTo: 'non-owner' } })
  public netAiming: boolean = false;
  // Silicon store state (owner only).
  /** Merchant's Charm expiry, epoch ms (0 = inactive). */
  private sellBonusUntil = 0;
  /** The Silicon store UI is open (gameplay frozen, cursor free). */
  private storeOpen = false;
  /** This pawn is the store's reward target (the local player). */
  private isStoreTarget = false;
  // Owner: last values sent to the server, so they are sent on change only.
  private sentMaxSpeed = -1;
  private sentSpeedModifier = -1;
  private sentAiming = false;

  // Movement intent captured from the controller (relative to the camera).
  private inForward = 0;
  private inRight = 0;

  // Frames remaining to hold the `doPickup` parameter true (one-shot pulse).
  private pickupPulse = 0;
  private pickupSpeedApplied = false;

  // Free-look state.
  private rmbHeld = false;   // RMB = aim (ranged)
  private middleHeld = false; // middle mouse (scroll button) = free-look camera
  private aiming = false; // true while holding RMB with a ranged weapon (scope/aim mode)
  private camBaseCam: THREE.Vector3 | null = null; // camera's resting local offset within the spring arm
  private preAimArm = 0;        // spring-arm length captured when aim began (so scroll-zoom is preserved)
  private pivotBaseY: number | null = null; // resting camera-pivot height (raised while aiming)
  private aimWasActive = false; // previous-frame aim state, for rising-edge capture
  private aimBlend = 0; // 0 = normal camera, 1 = aim (over-shoulder zoom)
  private aimLayerWeight = 0;               // smoothed upper-body aim-layer weight
  private aimLayerState: string | null = null; // current aim-layer state ('aim_bow'/'aim_1h'/null)
  private spineBone: THREE.Object3D | null = null; // torso bones for the aim-pitch bend
  private chestBone: THREE.Object3D | null = null;
  private spineBaseX = 0; // bind-pose pitch of each, captured once (we SET absolute, never accumulate)
  private chestBaseX = 0;
  private torsoResolved = false;
  private freeLookYaw = 0;
  private freeLookPitch = 0;

  // Camera orientation in world space (independent of the character's facing).
  private camYaw = 0;
  private camPitch = 0;
  private camInitialized = false;

  // Health / death / respawn.
  private waterSurfaceY: number | null = null;   // cached world Y of the WaterNode surface (deadly)
  private health = MAX_HEALTH;
  private isDead = false;
  private readonly spawnPoint = new THREE.Vector3();     // original spawn position — respawn target
  private readonly lastSafeGround = new THREE.Vector3(); // last position while safely grounded
  private readonly lastSafeDir = new THREE.Vector3();    // horizontal move direction at that moment (for inland offset)
  private hasSafeGround = false;
  private healthBar: HealthBar | null = null;
  private statusHUD: StatusHUD | null = null;
  private fadeOverlay: FadeOverlay | null = null;
  private readonly tmpVec = new THREE.Vector3();

  // Shop / interaction / inventory.
  private shopUI: ShopUI | null = null;
  private gearShopUI: GearShopUI | null = null;
  private backpackUI: BackpackUI | null = null;
  private interactPrompt: InteractPrompt | null = null;
  private crosshair: Crosshair | null = null;
  private weaponTuner: WeaponTuner | null = null;
  private inventory: Inventory | null = null;
  private hotbarInventory: Inventory | null = null;
  private goldHUD: GoldHUD | null = null;
  private gold = 0;
  private restoring = false;    // true while loading a save (suppresses re-saving mid-restore)
  private damageMult = 1;       // 2x while a red damage potion is active
  private speedTimer = 0;       // remaining seconds of the speed buff
  private damageTimer = 0;      // remaining seconds of the damage buff
  private healTimer = 0;        // remaining seconds of heal-over-time
  private baseMaxSpeed = 0;     // movement max speed without the speed buff
  private sprinting = false;    // Shift held → sprint (tap Shift also dashes)
  private shopOpen = false;              // true while ANY NPC menu (shop / gear shop) is open
  private activeMenuHide: (() => void) | null = null; // hides whichever menu is currently open
  private backpackOpen = false;
  private pauseMenu: PauseMenu | null = null;
  private lockHandler: (() => void) | null = null; // pointerlockchange -> opens pause when lock is lost
  private wasLocked = false;    // previous pointer-lock state (to detect the Esc-release edge)
  private paused = false;      // in-game pause menu open (world tick frozen)
  private preloading = false;  // assets loading behind the loading screen (control held)

  // Shop camera (a cinematic "trade shot" while the shop is open).
  private shopNpc: ENGINE.SceneNode | null = null;
  private shopCamActive = false;
  private shopCamReturning = false; // lerping the camera back to the follow rig after closing
  private readonly shopCamPos = new THREE.Vector3();        // animated current camera position
  private readonly shopCamQuat = new THREE.Quaternion();    // animated current camera orientation
  private readonly shopCamTargetPos = new THREE.Vector3();  // framing target position
  private readonly shopCamTargetQuat = new THREE.Quaternion(); // framing target orientation
  private readonly shopCamMat = new THREE.Matrix4();
  private shopCamLerp = SHOP_CAM_LERP; // resolved from the shopkeeper's inspector settings on open

  // Equipment / hotbar.
  private hotbar: Hotbar | null = null;
  private characterMesh: ENGINE.ModelMeshNode | null = null;
  // Lazy weapon cache: each equip id -> its loaded socket node + trail tip marker. Weapons are
  // instantiated once on first equip and toggled visible thereafter.
  private readonly weaponNodes = new Map<string, { node: ENGINE.ModelMeshNode; tip: THREE.Object3D | null }>();
  private readonly weaponReq = new Set<string>();
  private equippedId: string | null = null; // weapon def id currently equipped (null = bare hands)
  private armed = false;
  private activeSlot = -1; // currently selected hotbar slot (-1 = none)

  // Attack combo state.
  private attackPulse = 0;
  private comboStep = 0;
  private lungeTimer = 0;
  private attackCooldown = 0;
  private meleeStrikeTimer = -1; // >0 = counting down to the strike frame of the current swing
  private knockbackTimer = 0;                       // >0 = mid-knockback (velocity burst)
  private knockbackSpeed = KNOCKBACK_SPEED;          // world-scaled launch speed of the current knockback
  private readonly knockbackDir = new THREE.Vector3();

  // Potion drink state (held bottle + Use_Item one-shot; effect fires at the gulp mid-point).
  private readonly potionNodes = new Map<string, ENGINE.ModelMeshNode>();
  private readonly potionReq = new Set<string>();
  private heldPotion: PotionEffect | null = null; // potion currently held in hand (ready to drink)

  // Held loot (visual-only): any loot item selected in the hotbar shows its 3D model in the hand.
  private readonly lootNodes = new Map<string, ENGINE.ModelMeshNode>();
  private readonly lootReq = new Set<string>();
  private heldLoot: string | null = null;         // modelUrl of the loot currently held (or null)

  // Transient text popups (both fade out): loot pickup toast + held-item name above the hotbar.
  private pickupToast: FadingText | null = null;
  private itemNamePopup: FadingText | null = null;
  private drinkPulse = 0;          // frames to hold the `doDrink` param true (one-shot pulse)
  private drinking = false;
  private drinkTimer = 0;          // seconds into the current drink
  private drinkEffect: PotionEffect | null = null;
  private drinkSlot = -1;          // hotbar slot the potion was drunk from
  private drinkEffectApplied = false;

  // Dodge state.
  private dodgePulse = 0;
  private dodgeDir = 0;      // 0=F, 1=B, 2=L, 3=R
  private dodgeFwd = 0;      // local forward burst sign
  private dodgeRight = 0;    // local right burst sign
  private dodgeTimer = 0;
  private dodgeElapsed = 0;
  private dodgeCooldown = 0;
  private invincible = false;
  private wasDodging = false;

  // Foot dust VFX.
  private runDust: ENGINE.VFXNode | null = null;
  private burstDust: ENGINE.VFXNode | null = null;
  private dashDust: ENGINE.VFXNode | null = null;
  private dustEmitting = false;
  private footstepTimer = 0; // cadence counter for footstep SFX while moving
  // Ambient audio: in-game music + wind gusts appear at random intervals (Minecraft-style), not on a loop.
  private gameMusicTimer = 45 + Math.random() * 90; // first track after 45-135s
  private windTimer = 18 + Math.random() * 32;       // first gust after 18-50s
  private wasGrounded = true;

  // Weapon slash trail (follows the equipped weapon's tip).
  private trail: WeaponTrailNode | null = null;
  private wasAttacking = false;
  private trailCaptureTimer = 0;
  private lastTrailCombo = -1;

  // Ranged aim trajectory preview.
  private trajectory: TrajectoryPreview | null = null;

  // Ranged charge (built while aiming): scales projectile speed + accuracy. Reset on each shot.
  private chargeBar: ChargeBar | null = null;
  private chargeTimer = 0;   // seconds of charge accumulated
  private fireCdTimer = 0;    // reload cooldown remaining
  private charge01 = 0;       // normalized charge for the equipped weapon this frame

  /** True during the dodge i-frame window (hook for a future damage system). */
  public isInvincible(): boolean { return this.invincible; }

  //====================================================================================================
  // Setup: model + animation
  //====================================================================================================

  public override initialize(options?: ENGINE.CharacterPawnOptions): void {
    super.initialize(options);
    // Uniformly shrink the whole pawn (visual mesh, collision capsule child and camera rig).
    // The capsule collider is registered with the pawn's world scale, so physics shrinks too.
    if (CHARACTER_SCALE !== 1) this.scale.setScalar(CHARACTER_SCALE);
  }

  /**
   * The base pawn derives locomotion animation params (isRunning + a forward/back/right/left
   * blend) from the raw movement velocity, using an absolute 2 m/s run threshold. Our max speed
   * is scaled down with the pawn, so those velocities never reach the animation's expected range
   * and the walk/run cycle never plays. Rescale the locomotion params back to full-size speeds
   * (÷ CHARACTER_SCALE) so the state machine blends exactly as it would at scale 1.
   */
  protected override getAnimationParameters(): Record<string, unknown> {
    const params = super.getAnimationParameters();
    if (CHARACTER_SCALE === 1) return params;
    const inv = 1 / CHARACTER_SCALE;
    for (const key of ['forward', 'back', 'right', 'left']) {
      if (typeof params[key] === 'number') params[key] = (params[key] as number) * inv;
    }
    const mn = this.movementNode;
    if (mn instanceof ENGINE.CharacterMovementNode) {
      const { forward, right } = mn.getVelocities();
      params.isRunning = Math.hypot(forward, right) * inv > 2;
    }
    return params;
  }

  protected override setupVisualNode(): ENGINE.SceneNode | null {
    // Right-hand socket for holding weapons (MeshSocket isn't exported, so build the
    // socket definition as a plain object — ModelMeshNode.rebuildSockets reads these fields).
    const socket = {
      name: SOCKET_NAME,
      boneName: HAND_BONE,
      offsetLocation: DAGGER_OFFSET_POS.clone(),
      offsetRotation: DAGGER_OFFSET_ROT.clone(),
      // The socket's updateMatrixWorld strips the parent's world scale (to ignore bone scaling),
      // which also drops the pawn's CHARACTER_SCALE — so bake it into the socket offset scale
      // here, otherwise the socketed dagger renders at full (unscaled) size.
      offsetScale: new THREE.Vector3(CHARACTER_SCALE, CHARACTER_SCALE, CHARACTER_SCALE),

    } as any;
    // Left-hand socket (bows are held here — the right hand draws the string).
    const socketL = {
      name: SOCKET_NAME_L,
      boneName: HAND_BONE_L,
      offsetLocation: DAGGER_OFFSET_POS.clone(),
      offsetRotation: DAGGER_OFFSET_ROT.clone(),
      offsetScale: new THREE.Vector3(CHARACTER_SCALE, CHARACTER_SCALE, CHARACTER_SCALE),
    } as any;

    const meshNode = ENGINE.ModelMeshNode.create({
      name: 'MeshNode',
      modelUrl: BARBARIAN_MODEL_URL,
      material: BARBARIAN_MATERIAL_URL,
      scale: new THREE.Vector3(MODEL_SCALE, MODEL_SCALE, MODEL_SCALE),
      // Model faces +Z; rotate so it faces the pawn's forward (-Z).
      rotation: new THREE.Euler(0, Math.PI, 0),
      position: new THREE.Vector3(0, MESH_Y, 0),
      physicsOptions: { enabled: false },
      castShadow: true,
      sockets: [socket, socketL],
    });
    this.characterMesh = meshNode;
    this.add(meshNode);
    return meshNode;
  }

  protected override createMovementNode(): ENGINE.BasePawnMovementNode {
    const defaults = ENGINE.CharacterMovementNode.DEFAULT_CHARACTER_CONTROLLER_OPTIONS;
    const step = defaults.autoStepConfig;
    const node = ENGINE.CharacterMovementNode.create({
      name: 'MovementNode',
      characterControllerOptions: {
        ...defaults,
        // Firmer grounding to reduce vertical micro-oscillation ("ground jitter"), scaled to size.
        offset: 0.02 * CHARACTER_SCALE,
        snapToGroundDistance: 0.2 * CHARACTER_SCALE,
        // Scale gravity with the pawn. Jump height = v^2/2g; scaling BOTH the launch velocity
        // (below) and gravity linearly keeps the jump height proportional to the character AND
        // the air-time identical to full size — so a small character doesn't plummet unnaturally.
        simulatedGravityScale: (defaults.simulatedGravityScale ?? 5) * CHARACTER_SCALE,
        // Auto-step height defaults to CHARACTER_HEIGHT/4 (absolute) — scale it so the tiny pawn
        // doesn't teleport up ledges several times its own height.
        autoStepConfig: step ? { ...step, maxHeight: step.maxHeight * CHARACTER_SCALE } : step,
      },
    });
    // Scale horizontal speed and jump velocity to the pawn size so locomotion stays proportional
    // (a tiny character at the default 5 m/s would look like it's rocketing across the map).
    node.maxSpeed *= CHARACTER_SCALE * 1.4; // +40% base move speed (was +20%; base walk felt too slow)
    // Engine 19 lowered the default jumpSpeed from 20 to 12 m/s; pin the original 20 so the jump
    // height the map was tuned for is unchanged.
    node.jumpSpeed = 20 * CHARACTER_SCALE;
    return node as ENGINE.BasePawnMovementNode;
  }

  protected override setupAnimationNode(): ENGINE.AnimationStateMachineNode | null {
    const animationNode = ENGINE.AnimationStateMachineNode.create({
      name: 'AnimationNode',
      configUrl: BARBARIAN_ANIM_CONFIG_URL,
    });
    this.add(animationNode);
    return animationNode;
  }

  public override beginPlay(): boolean {
    if (!super.beginPlay()) return false;
    const mnBase = this.movementNode;
    if (mnBase instanceof ENGINE.CharacterMovementNode) this.baseMaxSpeed = mnBase.maxSpeed;
    // Stop the directional light from re-centering on the pawn every frame — that makes the
    // shadow map texels swim across the ground (looks like the ground is jittering).
    this.enableDirectionalLightFollowing = false;

    // Cache the water surface height (first WaterNode in the scene) — touching it is lethal.
    const waters = this.getWorld()?.getRootNodes(WaterNode) ?? [];
    if (waters.length > 0) {
      this.waterSurfaceY = waters[0].getWorldPosition(new THREE.Vector3()).y;
    }
    // Capture the original spawn position (death respawns here) + seed the safe-ground tracker.
    this.getWorldPosition(this.spawnPoint);
    this.getWorldPosition(this.lastSafeGround);
    this.hasSafeGround = true;

    // Foot dust emitters (at the feet). Run dust loops while moving; burst is one-shot.
    this.runDust = ENGINE.VFXNode.create({ name: 'RunDust', vfxDefinition: ENGINE.VFXDefinition.fromJSON(scaledVfx(RUN_DUST, CHARACTER_SCALE)), autoStart: false });
    this.runDust.position.set(0, FEET_OFFSET_Y, 0);
    this.add(this.runDust);
    this.burstDust = ENGINE.VFXNode.create({ name: 'BurstDust', vfxDefinition: ENGINE.VFXDefinition.fromJSON(scaledVfx(BURST_DUST, CHARACTER_SCALE)), autoStart: false });
    this.burstDust.position.set(0, FEET_OFFSET_Y, 0);
    this.add(this.burstDust);
    this.dashDust = ENGINE.VFXNode.create({ name: 'DashDust', vfxDefinition: ENGINE.VFXDefinition.fromJSON(scaledVfx(DASH_DUST, CHARACTER_SCALE)), autoStart: false });
    this.dashDust.position.set(0, FEET_OFFSET_Y, 0);
    this.add(this.dashDust);
    // Weapon slash trail (world-space ribbon, added to the world root).
    this.trail = WeaponTrailNode.create({ name: 'SlashTrail' });
    this.getWorld()?.add(this.trail);
    // Ranged aim trajectory preview (world-space line).
    this.trajectory = TrajectoryPreview.create({ name: 'AimTrajectory' }) as TrajectoryPreview;
    this.getWorld()?.add(this.trajectory);
    // RMB = aim (ranged). Middle (scroll button) held = free-look camera.
    this.onMouseDown.add((button: ENGINE.MouseButton) => {
      if (button === ENGINE.MouseButton.Right) this.rmbHeld = true;
      else if (button === ENGINE.MouseButton.Middle) this.middleHeld = true;
      return false;
    });
    this.onMouseUp.add((button: ENGINE.MouseButton) => {
      if (button === ENGINE.MouseButton.Right) this.rmbHeld = false;
      else if (button === ENGINE.MouseButton.Middle) this.middleHeld = false;
      return false;
    });
    // Left mouse button: attack (advances the combo).
    this.onMouseDown.add((button: ENGINE.MouseButton) => {
      if (button === ENGINE.MouseButton.Left) this.triggerAttack();
      return false;
    });
    // Keyboard: pickup (F) + hotbar select (1-9).
    this.onKeyDown.add((e: KeyboardEvent) => {
      if (e.repeat) return false;
      if (e.code === 'Escape') {
        // Close whatever is open (these states have a free cursor, so the engine handler gets Esc).
        // Opening pause from locked gameplay is handled by the window listener below, because the
        // browser grabs Esc to exit pointer-lock before the engine handler ever sees it.
        if (this.shopOpen) { this.closeShop(); return true; }
        if (this.backpackOpen) { this.closeBackpack(); return true; }
        if (this.paused) { this.closePause(); return true; }
        return true;
      }
      // B toggles the backpack (not while shopping / mid camera return / dead).
      if (e.code === 'KeyB' && !this.shopOpen && !this.shopCamReturning && !this.isDead) {
        this.toggleBackpack();
        return true;
      }
      // T opens the Silicon store (when installed), not while another menu is open.
      if (e.code === STORE_KEY && !this.shopOpen && !this.shopCamReturning && !this.backpackOpen && !this.isDead && !this.storeOpen) {
        this.openSiliconStore();
        return true;
      }
      if (this.shopOpen || this.backpackOpen || this.storeOpen) return false; // ignore gameplay keys while a menu is open
      if (e.code === PICKUP_KEY) {
        this.pickupPulse = 2;             // play the pickup gesture
        const loot = this.nearestLoot();  // grab any loot right at the player's feet
        if (loot) this.serverPickup(loot.lootId);
      } else if (e.code === DASH_KEY) {
        this.triggerDodge();     // tap Q = dash burst
      } else if (SPRINT_KEYS.includes(e.code)) {
        this.sprinting = true;   // hold Shift = sprint
      } else if (e.code.startsWith('Digit')) {
        const n = Number(e.code.slice(5));
        if (n >= 1 && n <= HOTBAR_SLOT_COUNT) this.selectSlot(n - 1);
      }
      return false;
    });

    // Release Shift → stop sprinting.
    this.onKeyUp.add((e: KeyboardEvent) => {
      if (SPRINT_KEYS.includes(e.code)) this.sprinting = false;
      return false;
    });

    // Hotbar HUD (slot 1 = dagger). Starts barehand (nothing selected).
    // HUD, menus, save data and the loading screen belong to the player on THIS screen only: other
    // players' pawns (and the headless co-op server) skip them.
    const gc = this.getWorld()?.gameContainer;
    if (gc && this.isLocalOwner()) {
      void installGameFont(gc); // apply the custom Trimen font to all game UI
      // Hotbar is its own small inventory (4 slots) so items can be dragged between it and the
      // backpack. Slot 1 starts with the dagger. Selecting a slot equips whatever item sits in it.
      this.hotbarInventory = new Inventory(HOTBAR_SLOT_COUNT);
      // Start with only the dagger; axe/blade are bought from the Ranger's gear shop.
      const starter = WEAPONS['dagger'];
      if (starter) this.hotbarInventory.set(0, { icon: starter.icon, name: starter.name, equipId: starter.id, iconModelUrl: starter.iconUrl, iconTextureUrl: starter.iconTextureUrl });
      this.hotbar = new Hotbar(gc, this.hotbarInventory, (i) => this.selectSlot(i));
      // If the item in the active slot changes (dragged out, or a different item dropped in), refresh
      // what's held in hand to match — weapon, potion, loot, or empty.
      this.hotbarInventory.onChange(() => this.refreshActiveSlot());
      this.healthBar = new HealthBar(gc);
      this.healthBar.setHealth(this.health, MAX_HEALTH);
      this.chargeBar = new ChargeBar(gc);
      this.statusHUD = new StatusHUD(gc);
      this.fadeOverlay = new FadeOverlay(gc);
      this.interactPrompt = new InteractPrompt(gc);
      this.crosshair = new Crosshair(gc);
      // Shared player inventory (3x4 = 12 slots) — used by the backpack and the sell shop. Starts
      // EMPTY: the player begins with only the dagger (in the hotbar) and must hunt loot for gold,
      // then buy weapons/potions/arrows from the shops. (Full economy loop — no starter seeds.)
      this.inventory = new Inventory(12);
      this.goldHUD = new GoldHUD(gc, this.gold);
      this.shopUI = new ShopUI(gc, () => this.closeShop(), this.inventory, (total) => this.addGold(this.applySellBonus(total)), () => this.gold);
      this.gearShopUI = new GearShopUI(
        gc,
        () => this.closeShop(),
        (_cat, item) => this.buyGear(item),
        (item) => (item.equipId ? this.ownsWeapon(item.equipId) : false),
        () => this.gold,
      );
      this.backpackUI = new BackpackUI(gc, this.inventory, () => this.closeBackpack());

      // Restore saved progress (gold + both inventories) if a previous run was saved. Done before
      // wiring the auto-save listeners so the restore itself doesn't trigger a redundant save.
      const saved = loadProgress();
      if (saved) {
        this.restoring = true;
        this.gold = saved.gold;
        // Grow first (Hunter's Satchel) so the extra backpack slots load too.
        if (typeof saved.backpackSize === 'number') this.inventory.grow(Math.min(saved.backpackSize, SATCHEL_BACKPACK_SIZE));
        this.sellBonusUntil = typeof saved.sellBonusUntil === 'number' ? saved.sellBonusUntil : 0;
        if (Array.isArray(saved.hotbar)) this.hotbarInventory.load(saved.hotbar);
        if (Array.isArray(saved.backpack)) this.inventory.load(saved.backpack);
        this.goldHUD.set(this.gold);
        this.restoring = false;
      }
      // Auto-save whenever either inventory changes (buy, sell, pickup, drag, consume).
      this.hotbarInventory.onChange(() => this.persist());
      this.inventory.onChange(() => this.persist());
      // This is the local player: Silicon store purchases are delivered here.
      StoreRewards.setTarget(this);
      this.isStoreTarget = true;

      this.pauseMenu = new PauseMenu(gc, () => this.closePause(), () => this.gotoMainMenu(), (v) => this.applyVolume(v));
      // Loot-pickup toast (top-centre, big) + held-item name flash (above the hotbar) — both fade out.
      this.pickupToast = new FadingText(gc, {
        css: { top: '14%', left: '50%', transform: 'translateX(-50%)', color: '#fff', font: '800 34px system-ui, sans-serif', textShadow: '0 2px 8px rgba(0,0,0,0.85)' },
        holdSeconds: 1.4, fadeSeconds: 0.8,
      });
      this.itemNamePopup = new FadingText(gc, {
        css: { bottom: '120px', left: '50%', transform: 'translateX(-50%)', color: '#ffe9c2', font: '800 26px system-ui, sans-serif', textShadow: '0 2px 6px rgba(0,0,0,0.85)' },
        holdSeconds: 1.0, fadeSeconds: 0.5,
      });
      // Apply the saved master volume up front.
      this.applyVolume(getSettings().volume);
      // Open pause when the player presses Esc during gameplay. Chrome does NOT deliver the Esc
      // keydown that releases pointer-lock, so we detect it via the pointer-lock CHANGE edge instead:
      // if the lock is lost while we're in normal play (no menu open), that Esc means "pause".
      this.lockHandler = () => {
        const locked = document.pointerLockElement != null;
        if (!locked && this.wasLocked && !this.paused && !this.shopOpen && !this.backpackOpen && !this.storeOpen && !this.preloading && !this.isDead) {
          this.openPause();
        }
        this.wasLocked = locked;
      };
      document.addEventListener('pointerlockchange', this.lockHandler);

      // Preload all gameplay assets behind a loading screen so nothing pops in; hold control until done.
      this.preloading = true;
      LoadingScreen.show(gc);
      void preloadGameAssets().finally(() => { this.preloading = false; LoadingScreen.hide(); });
    }
    return true;
  }

  /** Random in-game music track + occasional wind gusts (not looped — they surface unpredictably). */
  private updateAmbientAudio(deltaTime: number): void {
    if (this.preloading) return;
    this.gameMusicTimer -= deltaTime;
    if (this.gameMusicTimer <= 0) {
      Sfx.playTrack('gameMusic', 'Music', 0.4);
      this.gameMusicTimer = 210 + Math.random() * 210; // next track in ~3.5-7 min
    }
    this.windTimer -= deltaTime;
    if (this.windTimer <= 0) {
      Sfx.playTrack('wind', 'Ambience', 0.5);
      this.windTimer = 25 + Math.random() * 50; // gusts every 25-75s
    }
  }

  /** Set master audio volume (0..1). */
  private applyVolume(v: number): void {
    this.getWorld()?.globalAudioManager?.getBus('Master')?.setVolume(v);
  }

  /** Open the in-game pause menu: freeze the world, free the cursor, show the overlay. */
  private openPause(): void {
    if (this.paused || this.isDead || this.shopOpen || this.backpackOpen || this.storeOpen || this.preloading) return;
    this.paused = true;
    // Solo freezes the world. Co-op cannot (the hunt goes on for the other player); the pause flag
    // still roots this player in place while the menu is open.
    if (!isOnline()) this.getWorld()?.consoleManager?.executeConsoleCommand('pause');
    this.pauseMenu?.show();
    this.setCursorFree(true);
    Sfx.play('uiOpen', 0.7);
  }

  private closePause(): void {
    if (!this.paused) return;
    this.paused = false;
    if (!isOnline()) this.getWorld()?.consoleManager?.executeConsoleCommand('pause'); // toggle back to running
    this.pauseMenu?.hide();
    this.setCursorFree(false);
    Sfx.play('uiClose', 0.7);
  }

  /** Leave the game and return to the main-menu scene. */
  private gotoMainMenu(): void {
    if (this.paused && !isOnline()) this.getWorld()?.consoleManager?.executeConsoleCommand('pause'); // unfreeze before the switch
    this.paused = false;
    // Cover the scene swap so the raw menu-backdrop map isn't shown before the menu overlay/camera
    // are up — MainMenuNode hides this once it has built.
    const gc = this.getWorld()?.gameContainer;
    if (gc) LoadingScreen.show(gc);
    const gameLoop = this.getWorld()?.gameLoop;
    // Co-op: leave the server; disconnecting reloads the project's start scene (the title menu).
    if (ENGINE.NetRuntime.isClient()) void gameLoop?.disconnectFromServer();
    else void gameLoop?.openLevel(MENU_SCENE_URL);
  }

  /** Refresh the status HUD: arrow count + active potion-effect countdowns. */
  private updateStatusHUD(): void {
    if (!this.statusHUD) return;
    const rows: StatusRow[] = [];
    const arrows = this.inventory?.countOf('arrow') ?? 0;
    rows.push({ key: 'arrow', modelUrl: ARROW_ITEM.modelUrl, textureUrl: ARROW_ITEM.textureUrl, text: `${arrows}` });
    if (this.speedTimer > 0) rows.push({ key: 'speed', modelUrl: POTIONS.speed.modelUrl, text: `${Math.ceil(this.speedTimer)}s` });
    if (this.damageTimer > 0) rows.push({ key: 'damage', modelUrl: POTIONS.damage.modelUrl, text: `${Math.ceil(this.damageTimer)}s` });
    if (this.healTimer > 0) rows.push({ key: 'heal', modelUrl: POTIONS.heal.modelUrl, text: `${Math.ceil(this.healTimer)}s` });
    const charmLeft = this.sellBonusUntil - Date.now();
    if (charmLeft > 0) {
      // Merchant's Charm countdown, shown with the antler (the prize loot it pays more for).
      const mins = Math.ceil(charmLeft / 60000);
      rows.push({ key: 'charm', modelUrl: DROP_ITEMS.antler_rusa.modelUrl, text: `+25% ${mins}m` });
    }
    this.statusHUD.set(rows);
  }

  /** Nearest loot drop within pickup range, or null. */
  private nearestLoot(): LootDrop | null {
    if (LootDrop.all.length === 0) return null;
    const p = this.getWorldPosition(this.tmpVec);
    const c = new THREE.Vector3();
    let best: LootDrop | null = null;
    let bestD = LOOT_PICKUP_RANGE * LOOT_PICKUP_RANGE;
    for (const drop of LootDrop.all) {
      drop.getPickupPosition(c);
      const d = c.distanceToSquared(p);
      if (d <= bestD) { bestD = d; best = drop; }
    }
    return best;
  }

  /** Add one picked-up loot item to the backpack (stacked) and flash a short toast. */
  private onLootPickup(item: DropItem): void {
    this.inventory?.addStack({
      icon: item.icon, name: item.name, price: item.price,
      stackId: item.id, iconModelUrl: item.modelUrl, count: 1,
    });
    this.pickupToast?.show(`+1 ${item.name}`);
    Sfx.play('lootPickup', 0.8);
  }

  public override endPlay(): boolean {
    if (!super.endPlay()) return false;
    if (this.isStoreTarget) {
      StoreRewards.setTarget(null);
      this.isStoreTarget = false;
    }
    this.hotbar?.dispose();
    this.hotbar = null;
    this.healthBar?.dispose();
    this.healthBar = null;
    this.chargeBar?.dispose();
    this.chargeBar = null;
    this.statusHUD?.dispose();
    this.statusHUD = null;
    this.fadeOverlay?.dispose();
    this.fadeOverlay = null;
    this.interactPrompt?.dispose();
    this.interactPrompt = null;
    this.shopUI?.dispose();
    this.shopUI = null;
    this.gearShopUI?.dispose();
    this.gearShopUI = null;
    this.backpackUI?.dispose();
    this.backpackUI = null;
    this.pauseMenu?.dispose();
    this.pauseMenu = null;
    this.pickupToast?.dispose();
    this.pickupToast = null;
    this.itemNamePopup?.dispose();
    this.itemNamePopup = null;
    if (this.lockHandler) { document.removeEventListener('pointerlockchange', this.lockHandler); this.lockHandler = null; }
    LoadingScreen.hide();
    this.goldHUD?.dispose();
    this.goldHUD = null;
    this.crosshair?.dispose();
    this.crosshair = null;
    this.weaponTuner?.dispose();
    this.weaponTuner = null;
    this.trail?.removeFromParent();
    this.trail = null;
    this.trajectory?.removeFromParent();
    this.trajectory = null;
    return true;
  }

  //====================================================================================================
  // Health / death / respawn
  //====================================================================================================

  /**
   * Server / solo: apply damage. Reaching 0 health kills the pawn. `knockFrom` = the attacker's
   * position (throws the pawn back away from it). The owning player is told so their screen shows the
   * hit, the knockback and, at 0 health, the death fade. Calls on a client are ignored.
   */
  public takeDamage(amount: number, knockFrom?: THREE.Vector3, knockForce?: number): void {
    if (!this.hasAuthority() || this.isDead || amount <= 0) return;
    this.health = Math.max(0, this.health - amount);
    // Co-op server state: animals stop targeting this player until it respawns. (Solo: die() sets it.)
    if (this.health <= 0 && isOnline()) this.isDead = true;
    let dx = 0;
    let dz = 0;
    if (knockFrom) {
      const dir = this.getWorldPosition(new THREE.Vector3()).sub(knockFrom);
      dx = dir.x;
      dz = dir.z;
    }
    const force = knockForce ?? -1;
    if (isOnline()) this.clientOnDamaged(this.health, dx, dz, force);
    else this.onDamaged(this.health, dx, dz, force);
  }

  /** Owner: show a hit the server applied (health bar, hurt sound, knockback, death at 0). */
  private onDamaged(health: number, dx: number, dz: number, force: number): void {
    if (this.isDead) return; // already fading out
    this.health = health;
    this.healthBar?.setHealth(this.health, MAX_HEALTH);
    if (this.health > 0) Sfx.playRandom(['playerHurt1', 'playerHurt2', 'playerHurt3', 'playerHurt4', 'playerHurt5'], 0.8);
    if (dx !== 0 || dz !== 0) this.applyKnockback(new THREE.Vector3(dx, 0, dz), force >= 0 ? force : undefined);
    if (this.health <= 0) this.die();
  }

  @ENGINE.ClientRPC({
    params: [
      { netType: 'float', quantization: { mode: 'scale', scale: 10 } },
      { netType: 'float', quantization: { mode: 'scale', scale: 100 } },
      { netType: 'float', quantization: { mode: 'scale', scale: 100 } },
      { netType: 'float', quantization: { mode: 'scale', scale: 10 } },
    ],
  })
  public clientOnDamaged(health: number, dx: number, dz: number, force: number): void {
    this.onDamaged(health, dx, dz, force);
  }

  /**
   * Launch the pawn in the given (world, horizontal) direction — a decaying velocity burst.
   * `forcePreScale` overrides the default launch speed (pre-CHARACTER_SCALE); omit for the default.
   */
  public applyKnockback(dir: THREE.Vector3, forcePreScale?: number): void {
    if (dir.lengthSq() < 1e-6) return;
    this.knockbackDir.copy(dir).setY(0).normalize();
    this.knockbackSpeed = forcePreScale != null ? forcePreScale * CHARACTER_SCALE : KNOCKBACK_SPEED;
    this.knockbackTimer = KNOCKBACK_DURATION;
  }

  /** Owner: kill the pawn on screen: freeze, black fade, then ask the server to respawn it. */
  public die(): void {
    if (this.isDead) return;
    Sfx.play('playerDie', 0.9);
    this.isDead = true;
    this.health = 0;
    this.healthBar?.setHealth(0, MAX_HEALTH);
    const mn = this.movementNode;
    if (mn instanceof ENGINE.CharacterMovementNode) mn.setVelocities(0, 0, 0);
    if (this.fadeOverlay) this.fadeOverlay.flash(() => this.respawn());
    else this.respawn();
  }

  /** Teleport back to the ORIGINAL spawn point and restore full health (called at full black).
   *  Respawning at the start (not the last safe spot) makes death costly — a real setback.
   *  The owner moves at once (no wait at a black screen); the server's teleport is authoritative. */
  private respawn(): void {
    this.placeAtSpawn();
    this.health = MAX_HEALTH;
    this.healthBar?.setHealth(this.health, MAX_HEALTH);
    this.isDead = false;
    this.serverRespawn();
  }

  private placeAtSpawn(): void {
    const mn = this.movementNode;
    if (mn instanceof ENGINE.CharacterMovementNode) {
      mn.setVelocities(0, 0, 0);
      const pos = this.spawnPoint.clone();
      pos.y += RESPAWN_Y_OFFSET;
      mn.setPawnWorldTransform({ position: pos });
    }
  }

  /** Server: respawn a dead player at the spawn point with full health. */
  @ENGINE.ServerRPC()
  public serverRespawn(): void {
    if (isOnline()) this.placeAtSpawn(); // solo already moved in respawn()
    this.health = MAX_HEALTH;
    this.isDead = false;
    this.healTimer = 0;
  }

  /** Server / solo: the pawn sank into the deadly water. */
  private killByWater(): void {
    if (this.isDead) return;
    this.health = 0;
    if (isOnline()) this.isDead = true; // solo: die() sets it
    if (isOnline()) this.clientOnDamaged(0, 0, 0, -1);
    else this.onDamaged(0, 0, 0, -1);
  }

  //====================================================================================================
  // Silicon store: what each store item does in play (see data/storeItems.ts, systems/StoreRewards.ts)
  //====================================================================================================

  /** Apply one Temporary store item. False (nothing given) when it does not fit right now. */
  public grantStoreItem(sku: string): boolean {
    let ok = false;
    let message = '';
    switch (sku) {
      case SKU_QUIVER: {
        if ((this.inventory?.roomFor('arrow') ?? 0) < QUIVER_ARROWS) { message = 'Make room in your backpack for the arrows'; break; }
        this.inventory?.addStack({
          icon: ARROW_ITEM.icon, name: ARROW_ITEM.name, price: ARROW_ITEM.price, stackId: 'arrow',
          iconModelUrl: ARROW_ITEM.modelUrl, iconTextureUrl: ARROW_ITEM.textureUrl, count: QUIVER_ARROWS,
        });
        ok = true;
        message = `+${QUIVER_ARROWS} arrows`;
        break;
      }
      case SKU_POTION_KIT: {
        const kit: [PotionEffect, number, string, string][] = [
          ['heal', 2, '🟢', 'Health Potion'], ['speed', 1, '🔵', 'Speed Potion'], ['damage', 1, '🔴', 'Damage Potion'],
        ];
        const fits = kit.every(([effect, n]) =>
          (this.hotbarInventory?.roomFor(effect) ?? 0) + (this.inventory?.roomFor(effect) ?? 0) >= n);
        if (!fits) { message = 'Make room in your backpack for the potions'; break; }
        for (const [effect, n, icon, name] of kit) {
          for (let i = 0; i < n; i++) {
            const entry = { icon, name, potion: effect, count: 1, iconModelUrl: POTIONS[effect]?.modelUrl };
            if ((this.hotbarInventory?.addStack(entry) ?? -1) === -1) this.inventory?.addStack(entry);
          }
        }
        ok = true;
        message = 'Field Potion Kit added';
        break;
      }
      case SKU_GOLD_POUCH:
        this.addGold(GOLD_POUCH_AMOUNT);
        ok = true;
        message = `+${GOLD_POUCH_AMOUNT} gold`;
        break;
      case SKU_MERCHANT_CHARM:
        // Stacks: a second charm extends the running one.
        this.sellBonusUntil = Math.max(this.sellBonusUntil, Date.now()) + CHARM_DURATION_MS;
        this.persist();
        ok = true;
        message = "Merchant's Charm: loot sells for +25%";
        break;
      default:
        return false;
    }
    if (message) this.pickupToast?.show(message);
    Sfx.play(ok ? 'buy' : 'error', ok ? 0.8 : 0.5);
    return ok;
  }

  /** Apply a Permanent store item the player owns (idempotent: runs every session). */
  public applyPermanentItem(sku: string): void {
    if (sku === SKU_SATCHEL && this.inventory && this.inventory.size < SATCHEL_BACKPACK_SIZE) {
      this.inventory.grow(SATCHEL_BACKPACK_SIZE);
      this.persist();
    }
  }

  /** Sell total with the Merchant's Charm bonus, if active. */
  private applySellBonus(total: number): number {
    if (total <= 0 || Date.now() >= this.sellBonusUntil) return total;
    const boosted = Math.round(total * CHARM_SELL_MULT);
    this.pickupToast?.show(`Merchant's Charm +${boosted - total} gold`);
    return boosted;
  }

  /** Open the Silicon store (if installed), freezing the hunter and freeing the cursor. */
  private openSiliconStore(): void {
    const opened = StoreRewards.openStore(() => this.closeSiliconStore());
    if (!opened) return;
    this.storeOpen = true;
    this.setCursorFree(true);
    Sfx.play('uiOpen', 0.7);
  }

  private closeSiliconStore(): void {
    if (!this.storeOpen) return;
    this.storeOpen = false;
    this.setCursorFree(false);
    Sfx.play('uiClose', 0.7);
  }

  //====================================================================================================
  // Co-op: requests to the server and what the other players see
  //====================================================================================================

  /** True for the pawn the player on THIS screen controls (solo, or their own pawn in co-op). */
  private isLocalOwner(): boolean {
    return !ENGINE.NetRuntime.isHeadless() && this.isOwnedByLocalClient();
  }

  /** Server: hand a loot drop to this player if it is still there and within reach. */
  @ENGINE.ServerRPC({ params: [{ netType: 'uint' }] })
  public serverPickup(lootId: number): void {
    const drop = LootDrop.findById(lootId);
    if (!drop || this.isDead) return;
    const p = this.getWorldPosition(new THREE.Vector3());
    const c = drop.getPickupPosition(new THREE.Vector3());
    if (c.distanceTo(p) > LOOT_PICKUP_RANGE * 3) return; // allow for latency, refuse far grabs
    const item = drop.take();
    if (!item) return; // another player got it first
    if (isOnline()) this.clientGrantLoot(item.id);
    else this.onLootPickup(item);
  }

  @ENGINE.ClientRPC()
  public clientGrantLoot(itemId: string): void {
    const item = DROP_ITEMS[itemId];
    if (item) this.onLootPickup(item);
  }

  /** Damage of the current melee swing (weapon x potion buff). */
  private currentMeleeDamage(): number {
    const baseDmg = (this.equippedId ? WEAPONS[this.equippedId]?.damage : BAREHAND_DAMAGE) ?? BAREHAND_DAMAGE;
    return baseDmg * this.damageMult;
  }

  /** Server: land a melee swing from this pawn's server-side position and facing. */
  @ENGINE.ServerRPC({ params: [{ netType: 'float', quantization: { mode: 'scale', scale: 10 } }] })
  public serverMelee(damage: number): void {
    if (this.isDead) return;
    this.meleeHitScan(Math.min(Math.max(0, damage), maxHitDamage()));
  }

  /** Server: show this player's swing / shot animation on everyone else's screen. */
  @ENGINE.ServerRPC({ params: [{ netType: 'uint' }] })
  public serverAttackFx(comboStep: number): void {
    this.mcAttackFx(comboStep);
  }

  @ENGINE.MulticastRPC({ params: [{ netType: 'uint' }] })
  public mcAttackFx(comboStep: number): void {
    if (this.isLocalOwner()) return; // the shooter already animated it locally
    this.comboStep = comboStep;
    this.attackPulse = 2;
    if (!this.isRanged()) {
      const pos = this.getWorldPosition(new THREE.Vector3());
      if (!this.armed) Sfx.play3d('punch', pos, 0.6);
      else if (this.isTwoHand()) Sfx.play3d(comboStep === 3 ? 'axe360' : 'axe', pos, 0.6);
      else Sfx.play3d(comboStep % 2 === 1 ? 'dagger1' : 'dagger2', pos, 0.6);
    }
  }

  /** Server: relay an arrow so every player sees it; the server's copy deals the damage. */
  @ENGINE.ServerRPC({
    params: [
      { netType: 'vector3', quantization: { mode: 'scale', scale: 1000 } },
      { netType: 'vector3', quantization: { mode: 'scale', scale: 1000 } },
      { netType: 'float', quantization: { mode: 'scale', scale: 1000 } },
      { netType: 'float', quantization: { mode: 'scale', scale: 1000 } },
      { netType: 'float', quantization: { mode: 'scale', scale: 10 } },
    ],
  })
  public serverFireArrow(origin: THREE.Vector3, velocity: THREE.Vector3, gravity: number, maxDistance: number, damage: number): void {
    if (this.isDead) return;
    // The arrow must start near this pawn (no shots from across the map).
    if (origin.distanceTo(this.getWorldPosition(new THREE.Vector3())) > 3) return;
    this.mcFireArrow(origin, velocity, gravity, maxDistance, Math.min(Math.max(0, damage), maxHitDamage()));
  }

  @ENGINE.MulticastRPC({
    params: [
      { netType: 'vector3', quantization: { mode: 'scale', scale: 1000 } },
      { netType: 'vector3', quantization: { mode: 'scale', scale: 1000 } },
      { netType: 'float', quantization: { mode: 'scale', scale: 1000 } },
      { netType: 'float', quantization: { mode: 'scale', scale: 1000 } },
      { netType: 'float', quantization: { mode: 'scale', scale: 10 } },
    ],
  })
  public mcFireArrow(origin: THREE.Vector3, velocity: THREE.Vector3, gravity: number, maxDistance: number, damage: number): void {
    if (this.isLocalOwner()) return; // the shooter already flies its own copy
    if (!ENGINE.NetRuntime.isHeadless()) Sfx.play3d('bowFire', origin, 0.7);
    this.spawnArrowLocal(origin, velocity, gravity, maxDistance, damage);
  }

  /** Fly one arrow on this machine (damage only counts where this machine is the authority). */
  private spawnArrowLocal(origin: THREE.Vector3, velocity: THREE.Vector3, gravity: number, maxDistance: number, damage: number): void {
    const world = this.getWorld();
    if (!world) return;
    const arrow = ArrowProjectile.create({ name: 'Arrow' }) as ArrowProjectile;
    arrow.position.copy(origin);
    world.add(arrow);
    arrow.launch({
      modelUrl: ARROW.url,
      material: ARROW.material,
      modelScale: ARROW.scale * CHARACTER_SCALE,
      velocity: velocity.clone(),
      gravity,
      maxDistance,
      damage,
      ignoreRoot: this,
    });
  }

  /** Server: the weapon this player now holds (shown in their hand on other screens). */
  @ENGINE.ServerRPC()
  public serverSetEquipped(id: string): void {
    const next = id && WEAPONS[id] ? id : '';
    this.netEquippedId = next;
    this.showEquipped(next || null);
  }

  /** Other players: the server reported a weapon change. */
  public onRepNetEquippedId(): void {
    this.showEquipped(this.netEquippedId || null);
  }

  /** Put a weapon (or bare hands) in this pawn's hand, presentation only. */
  private showEquipped(id: string | null): void {
    this.equippedId = id;
    this.armed = id !== null;
    this.applyWeapon();
  }

  /** Server: aim pose on/off. */
  @ENGINE.ServerRPC()
  public serverSetAiming(aiming: boolean): void {
    this.netAiming = aiming;
  }

  /**
   * Server: the owner's current speed cap and speed modifier (sprint, speed potion, dash, aim,
   * knockback). The server simulates the same movement from the owner's inputs, so it needs the same
   * numbers or it would keep pulling the player back. Clamped to sane bounds.
   */
  @ENGINE.ServerRPC({
    params: [
      { netType: 'float', quantization: { mode: 'scale', scale: 1000 } },
      { netType: 'float', quantization: { mode: 'scale', scale: 1000 } },
    ],
  })
  public serverSetMoveTuning(maxSpeed: number, speedModifier: number): void {
    const mn = this.movementNode;
    if (!(mn instanceof ENGINE.CharacterMovementNode) || this.baseMaxSpeed <= 0) return;
    mn.maxSpeed = THREE.MathUtils.clamp(maxSpeed, 0, this.baseMaxSpeed * 1.4 * SPRINT_MULT);
    mn.speedModifier = THREE.MathUtils.clamp(speedModifier, 0, 20);
  }

  /** Server: a heal potion was drunk; heal over time here too so the server's health matches. */
  @ENGINE.ServerRPC()
  public serverStartHeal(): void {
    if (!this.isDead) this.healTimer = HEAL_DURATION;
  }

  /** Owner, co-op: send movement tuning / aim changes to the server (on change only). */
  private syncToServer(): void {
    if (!isOnline()) return;
    const mn = this.movementNode;
    if (mn instanceof ENGINE.CharacterMovementNode
      && (Math.abs(mn.maxSpeed - this.sentMaxSpeed) > 1e-4 || Math.abs(mn.speedModifier - this.sentSpeedModifier) > 1e-4)) {
      this.sentMaxSpeed = mn.maxSpeed;
      this.sentSpeedModifier = mn.speedModifier;
      this.serverSetMoveTuning(mn.maxSpeed, mn.speedModifier);
    }
    if (this.aiming !== this.sentAiming) {
      this.sentAiming = this.aiming;
      this.serverSetAiming(this.aiming);
    }
  }

  /**
   * Tick for a pawn this screen does not control: another player's pawn on a client, or any pawn on
   * the co-op server. Shows the replicated weapon / aim / attack state; the server also checks for
   * water deaths and runs heal-over-time.
   */
  private tickRemote(deltaTime: number): void {
    if (this.armed && this.equippedId && !this.weaponNodes.has(this.equippedId)) this.applyWeapon();
    if (this.hasAuthority()) {
      const bodyY = this.getWorldPosition(this.tmpVec).y;
      if (!this.isDead && this.waterSurfaceY !== null && bodyY < this.waterSurfaceY - WATER_DEATH_DEPTH) {
        this.killByWater();
      }
      if (this.healTimer > 0) {
        this.healTimer -= deltaTime;
        if (!this.isDead) this.health = Math.min(MAX_HEALTH, this.health + HEAL_RATE * deltaTime);
      }
    }
    if (this.animationNode && this.animationNode.isReady()) {
      this.animationNode.setParameter('armed', this.armed);
      this.animationNode.setParameter('twoHand', this.isTwoHand());
      this.animationNode.setParameter('ranged', this.isRanged());
      this.animationNode.setParameter('aiming', this.netAiming);
      this.animationNode.setParameter('attack', this.attackPulse > 0);
      this.animationNode.setParameter('comboStep', this.comboStep);
      if (this.attackPulse > 0) this.attackPulse--;
      const st = this.animationNode.getGraphState('base') ?? '';
      if (!ATTACK_STATES.has(st) && this.attackPulse <= 0) this.comboStep = 0;
    }
    // Locomotion blend from the replicated velocities (CharacterPawn), camera rig.
    super.tickPrePhysics(deltaTime);
  }

  //====================================================================================================
  // Shop / interaction
  //====================================================================================================

  /**
   * Shared NPC-menu open: frames the trade-shot camera on the NPC, freezes the player, frees the
   * cursor, and shows the given menu. Pressing the interact key again toggles the open menu closed.
   */
  private enterMenu(npc: ENGINE.SceneNode | undefined, show: () => void, hide: () => void): void {
    if (this.isDead) return;
    if (this.shopOpen) { this.closeShop(); return; } // toggle any open menu closed
    this.shopOpen = true;
    this.shopNpc = npc ?? null;
    this.activeMenuHide = hide;
    show();
    Sfx.play('uiOpen', 0.7);
    this.interactPrompt?.set('');
    // Hide the player's own body — the trade shot focuses on the NPC.
    if (this.characterMesh) this.characterMesh.visible = false;
    this.enterShopCam();
    this.setCursorFree(true);
  }

  /**
   * Free or re-lock the mouse cursor. Uses the InputManager (not raw document.exitPointerLock) because
   * the controller AUTO-RE-LOCKS the pointer whenever it's unlocked — only clearing the InputManager's
   * pointer-lock options actually keeps the cursor free while a menu is open.
   */
  private setCursorFree(free: boolean): void {
    const im = this.getWorld()?.inputManager;
    if (!im) return;
    if (free) im.exitPointerLock();
    else im.requestPointerLock({ unadjustedMovement: true });
  }

  /** Open the Rogue's shop (grid). Called by a shopkeeper interactable with menuKind 'shop'. */
  public openShop(npc?: ENGINE.SceneNode): void {
    if (!this.shopUI) return;
    this.enterMenu(npc, () => this.shopUI?.show(), () => this.shopUI?.hide());
  }

  /** Open the Ranger's gear shop (category carousel). Interactable menuKind 'gear'. */
  public openGearShop(npc?: ENGINE.SceneNode): void {
    if (!this.gearShopUI) return;
    this.enterMenu(npc, () => this.gearShopUI?.show(), () => this.gearShopUI?.hide());
  }

  /** Close whichever NPC menu is open and start the camera transition back to third-person. */
  public closeShop(): void {
    if (!this.shopOpen) return;
    this.shopOpen = false;
    this.activeMenuHide?.();
    this.activeMenuHide = null;
    Sfx.play('uiClose', 0.7);
    if (this.characterMesh) this.characterMesh.visible = true;
    // Hand the camera into the "returning" phase; it lerps back to the follow rig (same feel as the
    // entry swing), then releases in finishShopCamReturn().
    this.shopCamActive = false;
    this.shopCamReturning = true;
    this.shopNpc = null;
    this.setCursorFree(false);
  }

  /** Take manual control of the camera and compute the framed "trade shot" transform. */
  private enterShopCam(): void {
    if (!this.camera || !this.shopNpc) return;
    // Framing comes from the shopkeeper's inspector settings (duck-typed), falling back to defaults.
    const cfg = this.shopNpc as unknown as {
      camNodeName?: string; camDistance?: number; camHeight?: number; camFocusHeight?: number;
      camFrameYaw?: number; camFramePitch?: number; camLerp?: number;
    };
    const dist = cfg.camDistance ?? SHOP_CAM_DIST;
    const height = cfg.camHeight ?? SHOP_CAM_HEIGHT;
    const focusHeight = cfg.camFocusHeight ?? SHOP_CAM_FOCUS_HEIGHT;
    const frameYaw = cfg.camFrameYaw ?? SHOP_CAM_FRAME_YAW;
    const framePitch = cfg.camFramePitch ?? 0;
    this.shopCamLerp = cfg.camLerp ?? SHOP_CAM_LERP;

    // Seed the animated camera state from the camera's current world transform.
    this.camera.updateWorldMatrix(true, false);
    this.camera.matrixWorld.decompose(this.shopCamPos, this.shopCamQuat, new THREE.Vector3());

    const up = new THREE.Vector3(0, 1, 0);
    const npcPos = this.shopNpc.getWorldPosition(new THREE.Vector3());
    const focus = npcPos.clone().addScaledVector(up, focusHeight);

    // Camera position: a "ShopCam" marker node (drag it in the editor) if present, otherwise a point
    // computed from camDistance/camHeight on the player's side of the shopkeeper.
    const camNode = cfg.camNodeName ? this.getWorld()?.getNodeByName(cfg.camNodeName) : null;
    if (camNode) {
      camNode.getWorldPosition(this.shopCamTargetPos);
    } else {
      const dir = this.getWorldPosition(new THREE.Vector3()).sub(npcPos);
      dir.y = 0;
      if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1);
      dir.normalize();
      this.shopCamTargetPos.copy(focus).addScaledVector(dir, dist).addScaledVector(up, height);
    }

    // Look at the shopkeeper, then yaw so it sits on the right and leaves room for the UI on the left.
    const lookMat = new THREE.Matrix4().lookAt(this.shopCamTargetPos, focus, up);
    this.shopCamTargetQuat.setFromRotationMatrix(lookMat);
    const yaw = new THREE.Quaternion().setFromAxisAngle(up, THREE.MathUtils.degToRad(frameYaw));
    this.shopCamTargetQuat.premultiply(yaw);
    // Pitch (tilt) about the camera's local right axis: positive tilts up, negative tilts down.
    const pitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(framePitch));
    this.shopCamTargetQuat.multiply(pitch);

    // Stop the parent rig from driving the camera; we set its world matrix directly each frame.
    this.camera.matrixWorldAutoUpdate = false;
    this.shopCamActive = true;
  }

  /** Drive the "returning" phase: lerp the manual camera back to the live follow-rig transform. */
  private updateShopCamReturn(deltaTime: number): void {
    if (!this.camera) { this.finishShopCamReturn(); return; }
    // Compute where the follow rig wants the camera this frame (let it update, then read it back).
    this.camera.matrixWorldAutoUpdate = true;
    this.applyFollowRig();
    this.camera.updateWorldMatrix(true, false);
    const targetPos = new THREE.Vector3();
    const targetQuat = new THREE.Quaternion();
    this.camera.matrixWorld.decompose(targetPos, targetQuat, new THREE.Vector3());
    this.camera.matrixWorldAutoUpdate = false;

    const t = Math.min(1, this.shopCamLerp * deltaTime);
    this.shopCamPos.lerp(targetPos, t);
    this.shopCamQuat.slerp(targetQuat, t);

    // Close enough → hand control back to the rig.
    if (this.shopCamPos.distanceTo(targetPos) < 0.02) {
      this.finishShopCamReturn();
      return;
    }
    this.shopCamMat.compose(this.shopCamPos, this.shopCamQuat, ONE_SCALE);
    this.camera.matrixWorld.copy(this.shopCamMat);
    this.camera.matrixWorldInverse.copy(this.shopCamMat).invert();
  }

  private finishShopCamReturn(): void {
    this.shopCamReturning = false;
    if (this.camera) this.camera.matrixWorldAutoUpdate = true;
  }

  //====================================================================================================
  // Backpack
  //====================================================================================================

  private toggleBackpack(): void {
    if (this.backpackOpen) this.closeBackpack();
    else this.openBackpack();
  }

  /** Open the backpack overlay (freeze movement + free the cursor; no camera move). */
  public openBackpack(): void {
    if (!this.backpackUI || this.isDead || this.shopOpen) return;
    this.backpackOpen = true;
    this.backpackUI.show();
    this.interactPrompt?.set('');
    this.setCursorFree(true);
    Sfx.play('uiOpen', 0.7);
  }

  public closeBackpack(): void {
    if (!this.backpackOpen) return;
    this.backpackOpen = false;
    this.backpackUI?.hide();
    this.setCursorFree(false);
    Sfx.play('uiClose', 0.7);
  }

  /** Add gold (e.g. from selling loot) and refresh the HUD. */
  public addGold(amount: number): void {
    this.gold += amount;
    this.goldHUD?.set(this.gold);
    Sfx.play('gold', 0.7);
    this.persist();
  }

  /** Persist the current run (gold + inventories) to localStorage. No-op while restoring a save. */
  private persist(): void {
    if (this.restoring || !this.hotbarInventory || !this.inventory) return;
    saveProgress({
      gold: this.gold,
      hotbar: this.hotbarInventory.serialize(),
      backpack: this.inventory.serialize(),
      backpackSize: this.inventory.size,
      sellBonusUntil: this.sellBonusUntil,
    });
  }

  /** True if a weapon id already sits in the hotbar or backpack. */
  private ownsWeapon(id: string): boolean {
    for (const inv of [this.hotbarInventory, this.inventory]) {
      if (!inv) continue;
      for (let i = 0; i < inv.size; i++) if (inv.get(i)?.equipId === id) return true;
    }
    return false;
  }

  /** Buy a gear-shop item: a weapon, a potion, or arrows — granted as inventory items. */
  private buyGear(item: GearItem): BuyResult {
    // Arrows: one per buy, stacked in the backpack (max 8 per slot, spills to a new slot).
    if (item.ammo === 'arrow') {
      if (this.gold < item.price) return 'poor';
      const placed = this.inventory?.addStack({
        icon: ARROW_ITEM.icon, name: ARROW_ITEM.name, price: ARROW_ITEM.price, stackId: 'arrow',
        iconModelUrl: ARROW_ITEM.modelUrl, iconTextureUrl: ARROW_ITEM.textureUrl, count: 1,
      }) ?? -1;
      if (placed === -1) return 'poor'; // backpack full
      this.addGold(-item.price);
      return 'ok';
    }
    // Potions: granted as a stackable consumable — carried and drunk later, not applied on buy.
    if (item.potion) {
      if (this.gold < item.price) return 'poor';
      const potDef = POTIONS[item.potion as PotionEffect];
      const entry = { icon: item.icon, name: item.name, potion: item.potion, count: 1, iconModelUrl: potDef?.modelUrl };
      const placed = (this.hotbarInventory?.addStack(entry) ?? -1) !== -1
        || (this.inventory?.addStack(entry) ?? -1) !== -1;
      if (!placed) return 'poor';
      this.addGold(-item.price);
      return 'ok';
    }
    const id = item.equipId;
    if (!id || !WEAPONS[id]) return 'poor';
    if (this.ownsWeapon(id)) return 'owned';
    if (this.gold < item.price) return 'poor';
    const entry = { icon: item.icon, name: item.name, equipId: id, iconModelUrl: WEAPONS[id]?.iconUrl, iconTextureUrl: WEAPONS[id]?.iconTextureUrl };
    // Prefer the hotbar; fall back to the backpack. Bail (no charge) if both are full.
    const placed = (this.hotbarInventory?.add(entry) ?? -1) !== -1
      || (this.inventory?.add(entry) ?? -1) !== -1;
    if (!placed) return 'poor';
    this.addGold(-item.price);
    return 'ok';
  }

  /** Start a potion's TIMED effect: heal-over-time (10s), +40% speed (60s), or 2x damage (30s). */
  private applyPotion(kind: string): void {
    if (kind === 'heal') {
      this.healTimer = HEAL_DURATION;                         // +HEAL_RATE HP/s while active
      if (isOnline()) this.serverStartHeal();
    }
    else if (kind === 'speed') this.speedTimer = SPEED_DURATION;
    else if (kind === 'damage') this.damageTimer = DAMAGE_DURATION;
  }

  /** Tick the active potion effects: heal-over-time, speed buff, damage buff — and expire them. */
  private updateEffects(deltaTime: number): void {
    if (this.healTimer > 0) {
      this.healTimer -= deltaTime;
      this.health = Math.min(MAX_HEALTH, this.health + HEAL_RATE * deltaTime);
      this.healthBar?.setHealth(this.health, MAX_HEALTH);
    }
    if (this.speedTimer > 0) this.speedTimer -= deltaTime;
    if (this.damageTimer > 0) this.damageTimer -= deltaTime;
    // Apply the current buff states.
    const mn = this.movementNode;
    if (mn instanceof ENGINE.CharacterMovementNode) {
      const buffMult = this.speedTimer > 0 ? 1.4 : 1;
      const sprintMult = this.sprinting && !this.drinking && !this.isDead ? SPRINT_MULT : 1;
      mn.maxSpeed = this.baseMaxSpeed * buffMult * sprintMult;
    }
    this.damageMult = this.damageTimer > 0 ? 2 : 1;
  }

  //====================================================================================================
  // Potions (hold + drink)
  //====================================================================================================

  /** Hold a potion (from the given hotbar slot) in hand, ready to drink. Does NOT consume it. */
  private holdPotion(index: number, effect: PotionEffect): void {
    if (this.isDead || this.shopOpen || this.backpackOpen || !POTIONS[effect]) return;
    this.activeSlot = index;
    this.hotbar?.setActive(index);
    this.heldPotion = effect;
    this.equippedId = null; // a bottle occupies the hand — no weapon
    this.armed = false;
    this.hideLoot(); // a bottle occupies the hand — put away any held loot
    this.showPotion(effect); // bottle appears in the right hand (weapons hidden)
  }

  /** Left-click while holding a potion: play the drink gesture. Effect + consume happen mid-clip. */
  private startDrink(): void {
    if (this.drinking || !this.heldPotion || this.activeSlot < 0) return;
    if (this.isDead || this.shopOpen || this.backpackOpen) return;
    if (!this.animationNode?.isReady()) return;
    Sfx.play('drink', 0.8);
    this.drinking = true;
    this.drinkTimer = 0;
    this.drinkEffect = this.heldPotion;
    this.drinkSlot = this.activeSlot;
    this.drinkEffectApplied = false;
    this.drinkPulse = 2; // pulse the `doDrink` param -> enters the drink state
  }

  /** Show the given potion's bottle in the right hand, hiding EVERY weapon (a hand holds one thing). */
  private showPotion(effect: PotionEffect): void {
    for (const w of this.weaponNodes.values()) w.node.visible = false;
    for (const [id, node] of this.potionNodes) node.visible = id === effect;
    if (!this.potionNodes.has(effect)) this.loadPotionModel(effect);
  }

  /** Lazily load a potion bottle model, seat it in the right-hand socket, and normalize its size. */
  private loadPotionModel(effect: PotionEffect): void {
    if (!this.characterMesh || this.potionReq.has(effect)) return;
    const socket = this.characterMesh.getSocket(SOCKET_NAME);
    if (!socket) return;
    this.potionReq.add(effect);
    const def = POTIONS[effect];
    const node = ENGINE.ModelMeshNode.create({
      name: `Potion_${effect}`,
      modelUrl: def.modelUrl,
      physicsOptions: { enabled: false },
      castShadow: true,
    });
    node.visible = this.heldPotion === effect;
    socket.add(node);
    node.setPhysicsEnabled(false, true);
    this.potionNodes.set(effect, node);
    const fit = () => this.fitHeldModel(node, socket, POTION_GRIP);
    if (node.isModelLoaded?.()) fit();
    else node.onMeshLoaded?.add(() => fit());
  }

  /**
   * Normalize a raw held model to a consistent hand-held size and recenter it in the palm — source
   * glbs have wildly different scales/pivots, so seating them raw puts them huge and offset. `grip`
   * gives the target size + palm offset/rotation (used for potions and loot).
   */
  private fitHeldModel(node: ENGINE.ModelMeshNode, socket: THREE.Object3D, grip: HeldGrip): void {
    node.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(node);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    node.scale.multiplyScalar((grip.size * CHARACTER_SCALE) / maxDim); // target world height
    // Recenter: bring the model's world center to the socket origin (the palm), then nudge by grip.
    node.updateWorldMatrix(true, true);
    const center = new THREE.Box3().setFromObject(node).getCenter(new THREE.Vector3());
    socket.updateWorldMatrix(true, false);
    const localCenter = center.applyMatrix4(new THREE.Matrix4().copy(socket.matrixWorld).invert());
    node.position.sub(localCenter);
    node.position.x += grip.offsetPos[0];
    node.position.y += grip.offsetPos[1];
    node.position.z += grip.offsetPos[2];
    node.rotation.set(
      THREE.MathUtils.degToRad(grip.offsetRot[0]),
      THREE.MathUtils.degToRad(grip.offsetRot[1]),
      THREE.MathUtils.degToRad(grip.offsetRot[2]),
    );
  }

  /** Show a loot item's model in the right hand (visual only). Lazily loaded + size-normalized. */
  private holdLoot(modelUrl: string): void {
    this.heldLoot = modelUrl;
    // Hide any other held loot; reveal (or lazily load) the requested one.
    for (const [url, node] of this.lootNodes) node.visible = url === modelUrl;
    if (this.lootNodes.has(modelUrl)) return;
    if (!this.characterMesh || this.lootReq.has(modelUrl)) return;
    const socket = this.characterMesh.getSocket(SOCKET_NAME);
    if (!socket) return;
    this.lootReq.add(modelUrl);
    const node = ENGINE.ModelMeshNode.create({ name: 'HeldLoot', modelUrl, physicsOptions: { enabled: false }, castShadow: true });
    node.visible = this.heldLoot === modelUrl;
    socket.add(node);
    node.setPhysicsEnabled(false, true);
    this.lootNodes.set(modelUrl, node);
    const fit = () => this.fitHeldModel(node, socket, LOOT_GRIP);
    if (node.isModelLoaded?.()) fit();
    else node.onMeshLoaded?.add(() => fit());
  }

  /** Put away any held loot model. */
  private hideLoot(): void {
    this.heldLoot = null;
    for (const node of this.lootNodes.values()) node.visible = false;
  }

  /** Put the bottle away and restore the equipped weapon's visibility. */
  private hidePotion(): void {
    for (const node of this.potionNodes.values()) node.visible = false;
    this.heldPotion = null;
    this.applyWeapon(); // restores the equipped weapon's visible state (none while holding a potion)
  }

  /** Drive the drink sequence each frame: fire the effect at the gulp, then end and consume one. */
  private updateDrink(deltaTime: number): void {
    if (!this.drinking) return;
    this.drinkTimer += deltaTime;
    if (!this.drinkEffectApplied && this.drinkTimer >= DRINK_EFFECT_TIME) {
      this.drinkEffectApplied = true;
      if (this.drinkEffect) this.applyPotion(this.drinkEffect);
      this.hotbarInventory?.consumeOne(this.drinkSlot); // remove one from the stack
    }
    if (this.drinkTimer >= DRINK_TOTAL) {
      this.drinking = false;
      this.drinkEffect = null;
      this.drinkSlot = -1;
      // Keep holding for another sip if the stack survived; otherwise put the empty bottle away.
      const remaining = this.hotbarInventory?.get(this.activeSlot)?.potion;
      if (remaining && this.heldPotion) {
        this.showPotion(this.heldPotion);
      } else {
        this.activeSlot = -1;
        this.hotbar?.setActive(-1);
        this.hidePotion();
      }
    }
  }

  //====================================================================================================
  // Equipment / hotbar
  //====================================================================================================

  /**
   * Re-sync the item held in hand with whatever now sits in the active slot. Called on any hotbar
   * change so dragging a different item into the equipped slot (or emptying it) updates the hand,
   * not just the icon. Silent (no selection SFX) and guarded so unchanged slots don't churn.
   */
  private refreshActiveSlot(): void {
    if (this.drinking || this.activeSlot < 0) return;
    const item = this.hotbarInventory?.get(this.activeSlot);
    // Active slot emptied → put away whatever was in hand (weapon / potion / loot).
    if (!item) { this.equipWeapon(null); this.hideLoot(); return; }
    // Potion now in the active slot: hold the bottle.
    if (item.potion) {
      if (this.heldPotion !== item.potion) this.holdPotion(this.activeSlot, item.potion as PotionEffect);
      return;
    }
    // Loot model (no weapon/potion): hold it in bare hands.
    if (item.iconModelUrl && !item.equipId) {
      if (this.heldLoot !== item.iconModelUrl) { this.equipWeapon(null); this.holdLoot(item.iconModelUrl); }
      return;
    }
    // Weapon: equip the registered weapon in the slot (or bare hands for an unknown id).
    const nextId = item.equipId && WEAPONS[item.equipId] ? item.equipId : null;
    if (nextId !== this.equippedId) this.equipWeapon(nextId);
  }

  private selectSlot(index: number): void {
    if (this.drinking) return; // locked mid-drink: can't switch weapons/potions until the sip finishes
    // Pressing the already-active slot again deselects it (toggle off / unequip / put bottle away).
    if (this.activeSlot === index) {
      this.activeSlot = -1;
      this.hotbar?.setActive(-1);
      this.equipWeapon(null);
      Sfx.play('unequip', 0.6);
      return;
    }
    const item = this.hotbarInventory?.get(index);
    // Consumables (potions): SELECT holds the bottle in hand (ready) — it isn't drunk until the
    // player clicks (left mouse), so selecting never consumes it.
    if (item?.potion) {
      this.holdPotion(index, item.potion as PotionEffect);
      if (item.name) this.itemNamePopup?.show(item.name);
      Sfx.play('hotbarSelect', 0.6);
      return;
    }
    this.activeSlot = index;
    this.hotbar?.setActive(index);
    // Loot item (no weapon/potion, just a 3D model): hold it in hand, visual only.
    if (item && item.iconModelUrl && !item.equipId) {
      this.equipWeapon(null);              // bare hands (hides any weapon)
      this.holdLoot(item.iconModelUrl);
      if (item.name) this.itemNamePopup?.show(item.name);
      Sfx.play('hotbarSelect', 0.6);
      return;
    }
    // Item-driven equip: equip whatever registered weapon sits in the selected slot.
    const equipId = item?.equipId;
    this.equipWeapon(equipId && WEAPONS[equipId] ? equipId : null);
    if (item?.name && equipId) this.itemNamePopup?.show(item.name);
    if (equipId && WEAPONS[equipId]) {
      Sfx.play(WEAPONS[equipId]?.ranged ? 'equip' : 'equipMelee', 0.7); // ranged = bow/crossbow, else sword
    } else {
      Sfx.play('hotbarSelect', 0.6);
    }
  }

  /** Equip a registered weapon by id (or null for bare hands). Lazily loads the model. */
  private equipWeapon(id: string | null): void {
    // Switching to a weapon (or bare hands) puts away any held potion bottle + held loot.
    if (this.heldPotion) {
      this.heldPotion = null;
      for (const node of this.potionNodes.values()) node.visible = false;
    }
    if (id !== null) this.hideLoot(); // equipping a real weapon puts loot away (bare-hands keeps it for holdLoot)
    this.showEquipped(id);
    this.seedWeaponTuner();
    if (isOnline()) this.serverSetEquipped(id ?? '');
  }

  /** Seed the dev weapon tuner from the equipped weapon's current registry values. */
  private seedWeaponTuner(): void {
    if (!this.weaponTuner || !this.weaponTuner.isOpen()) return;
    const def = this.equippedId ? WEAPONS[this.equippedId] : null;
    if (!def) return;
    this.weaponTuner.setValues(def.id, {
      pos: [def.offsetPos[0], def.offsetPos[1], def.offsetPos[2]],
      rot: [def.offsetRot[0], def.offsetRot[1], def.offsetRot[2]],
      scale: def.scale,
    });
  }

  /** Apply live weapon-tuner values to the equipped weapon node (dev tool). */
  private applyWeaponTune(t: WeaponTune): void {
    if (!this.equippedId) return;
    const node = this.weaponNodes.get(this.equippedId)?.node;
    if (!node) return;
    node.position.set(t.pos[0], t.pos[1], t.pos[2]);
    node.rotation.set(
      THREE.MathUtils.degToRad(t.rot[0]),
      THREE.MathUtils.degToRad(t.rot[1]),
      THREE.MathUtils.degToRad(t.rot[2]),
    );
    node.scale.setScalar(t.scale);
  }

  /** True when the equipped weapon drives the two-hand attack set (axe). */
  private isTwoHand(): boolean {
    return this.equippedId ? (WEAPONS[this.equippedId]?.twoHand ?? false) : false;
  }

  /** True when the equipped weapon is ranged (bow/crossbow — fires arrows, shoot animation). */
  private isRanged(): boolean {
    return this.equippedId ? (WEAPONS[this.equippedId]?.ranged ?? false) : false;
  }

  /** The trail tip marker of the currently equipped weapon, if loaded. */
  private currentWeaponTip(): THREE.Object3D | null {
    return this.equippedId ? (this.weaponNodes.get(this.equippedId)?.tip ?? null) : null;
  }

  /**
   * Reflect the equipped state onto the socket: show the equipped weapon (loading it on first use)
   * and hide every other cached weapon. Called on equip and again once a weapon finishes loading.
   */
  private applyWeapon(): void {
    for (const [id, w] of this.weaponNodes) {
      w.node.visible = this.armed && id === this.equippedId;
    }
    if (this.armed && this.equippedId) {
      const def = WEAPONS[this.equippedId];
      if (def && !this.weaponNodes.has(def.id) && !this.weaponReq.has(def.id)) this.loadWeapon(def);
    }
  }

  /** Instantiate a weapon (prefab or raw model), seat it in the hand socket, cache it + its tip. */
  private loadWeapon(def: WeaponDef): void {
    if (!this.characterMesh) return;
    const socketName = def.socket === 'left' ? SOCKET_NAME_L : SOCKET_NAME;
    const socket = this.characterMesh.getSocket(socketName);
    if (!socket) return;
    this.weaponReq.add(def.id);

    const seat = (node: ENGINE.ModelMeshNode) => {
      // Local grip transform inside the socket (the socket already bakes CHARACTER_SCALE).
      node.scale.setScalar(def.scale);
      node.position.set(def.offsetPos[0], def.offsetPos[1], def.offsetPos[2]);
      node.rotation.set(
        THREE.MathUtils.degToRad(def.offsetRot[0]),
        THREE.MathUtils.degToRad(def.offsetRot[1]),
        THREE.MathUtils.degToRad(def.offsetRot[2]),
      );
      node.visible = this.armed && def.id === this.equippedId;
      socket.add(node);
      // Kill any collider so the weapon can't shove the character around from the hand.
      node.setPhysicsEnabled(false, true);
      const entry = { node, tip: null as THREE.Object3D | null };
      this.weaponNodes.set(def.id, entry);
      const build = () => { entry.tip = this.buildWeaponTip(node); };
      if (node.isModelLoaded?.()) build();
      else node.onMeshLoaded?.add(() => build());
      this.applyWeapon();
    };

    if (def.source === 'prefab') {
      ENGINE.instantiatePrefabAsync(def.url).then((node) => {
        if (!node) { this.weaponReq.delete(def.id); return; }
        const m = node as ENGINE.ModelMeshNode;
        if (def.material) m.modelMaterial = def.material;
        // Prefab carries its own scale — don't override it.
        m.position.set(def.offsetPos[0], def.offsetPos[1], def.offsetPos[2]);
        m.rotation.set(
          THREE.MathUtils.degToRad(def.offsetRot[0]),
          THREE.MathUtils.degToRad(def.offsetRot[1]),
          THREE.MathUtils.degToRad(def.offsetRot[2]),
        );
        m.visible = this.armed && def.id === this.equippedId;
        socket.add(m);
        m.setPhysicsEnabled(false, true);
        const entry = { node: m, tip: null as THREE.Object3D | null };
        this.weaponNodes.set(def.id, entry);
        const build = () => { entry.tip = this.buildWeaponTip(m); };
        if (m.isModelLoaded?.()) build();
        else m.onMeshLoaded?.add(() => build());
        this.applyWeapon();
      }).catch(() => { this.weaponReq.delete(def.id); });
    } else {
      const m = ENGINE.ModelMeshNode.create({
        name: `Weapon_${def.id}`,
        modelUrl: def.url,
        ...(def.material ? { material: def.material } : {}),
        physicsOptions: { enabled: false },
        castShadow: true,
      });
      seat(m);
    }
  }

  /**
   * Compute a weapon's real blade tip from its world bounding box (the face-center furthest from
   * the grip), convert it to weapon-local, and return a marker there — robust to any
   * scale/orientation. Runs once after the model loads.
   */
  private buildWeaponTip(weapon: ENGINE.ModelMeshNode): THREE.Object3D | null {
    weapon.updateWorldMatrix(true, false);
    const worldBox = new THREE.Box3().setFromObject(weapon);
    if (worldBox.isEmpty()) return null;

    // Build the bounding box in the weapon's LOCAL frame (grip is at local origin).
    const inv = new THREE.Matrix4().copy(weapon.matrixWorld).invert();
    const localBox = new THREE.Box3();
    const c = new THREE.Vector3();
    for (const x of [worldBox.min.x, worldBox.max.x]) {
      for (const y of [worldBox.min.y, worldBox.max.y]) {
        for (const z of [worldBox.min.z, worldBox.max.z]) {
          c.set(x, y, z).applyMatrix4(inv);
          localBox.expandByPoint(c);
        }
      }
    }
    const center = localBox.getCenter(new THREE.Vector3());
    // Candidate tips: the box extreme on each axis, centered on the other two (blade centerline).
    const cands = [
      new THREE.Vector3(localBox.max.x, center.y, center.z),
      new THREE.Vector3(localBox.min.x, center.y, center.z),
      new THREE.Vector3(center.x, localBox.max.y, center.z),
      new THREE.Vector3(center.x, localBox.min.y, center.z),
      new THREE.Vector3(center.x, center.y, localBox.max.z),
      new THREE.Vector3(center.x, center.y, localBox.min.z),
    ];
    // Grip is ~local origin; the blade tip is the face-center furthest from it.
    let tip = cands[0];
    let best = -1;
    for (const p of cands) {
      const d = p.lengthSq();
      if (d > best) { best = d; tip = p; }
    }
    const marker = new THREE.Object3D();
    marker.position.copy(tip);
    weapon.add(marker);
    return marker;
  }

  //====================================================================================================
  // Attack
  //====================================================================================================

  private triggerAttack(): void {
    if (this.isDead || this.shopOpen || this.backpackOpen || this.drinking) return;
    if (!this.animationNode?.isReady()) return;
    // Holding a potion? Left-click drinks it instead of attacking.
    if (this.heldPotion) { this.startDrink(); return; }
    const ranged = this.isRanged();
    // Ranged weapons only fire from aim mode; firing is gated by the weapon's reload (fireCooldown),
    // not the melee gap, and consumes the current charge.
    if (ranged) {
      if (!this.aiming || this.fireCdTimer > 0) return;
      if (!UNLIMITED_ARROWS && (this.inventory?.countOf('arrow') ?? 0) <= 0) { // no ammo -> dry click
        this.pickupToast?.show('Out of arrows!');
        Sfx.play('error', 0.5);
        return;
      }
    } else {
      if (this.attackCooldown > 0) return; // small anti-spam gap between swings
      this.attackCooldown = ATTACK_MIN_GAP;
    }
    const st = this.animationNode.getGraphState('base') ?? '';
    const inAttack = ATTACK_STATES.has(st);
    // Ranged weapons fire one shot per press (no melee combo chain).
    const maxCombo = ranged ? 1 : (this.armed ? COMBO_MAX_ARMED : COMBO_MAX_UNARMED);
    if (!inAttack) {
      this.comboStep = 1;
    } else if (this.comboStep < maxCombo) {
      this.comboStep++;
    } else {
      return; // combo maxed — ignore until it resets
    }
    this.attackPulse = 2;
    if (isOnline()) this.serverAttackFx(this.comboStep); // other players see the swing / shot
    if (ranged) {
      this.fireArrow(); // launch the projectile at the current charge
      const rs = this.rangedStats();
      this.fireCdTimer = rs?.fireCooldown ?? 0.4; // reload
      this.chargeTimer = 0;                        // must re-draw for the next shot
    } else {
      // Armed = weapon swipe; barehand combo is Punch (step 1) -> Kick (step 2).
      if (this.armed) {
        if (this.isTwoHand()) {
          // Axe: regular strikes use 'axe'; the spin (comboStep 3) uses 'axe360'.
          Sfx.play(this.comboStep === 3 ? 'axe360' : 'axe', 0.7);
        } else {
          // Dagger / 1H: alternate 1-2-1-2 across the combo.
          Sfx.play(this.comboStep % 2 === 1 ? 'dagger1' : 'dagger2', 0.7);
        }
      } else {
        Sfx.play('punch', 0.75); // barehand punch + kick share the same whoosh
      }
      this.lungeTimer = LUNGE_DURATION; // step forward on each melee swing
      this.meleeStrikeTimer = MELEE_STRIKE_DELAY; // hit lands mid-swing, not on click (no spam-hits)
    }
  }

  /**
   * Server / solo: strike every living animal in a frontal arc within melee reach (proximity, no
   * physics body). The animal plays the hit sound itself on every machine.
   */
  private meleeHitScan(dmg: number): void {
    if (!isAuthority() || WildAnimal.alive.length === 0) return;
    const origin = this.getWorldPosition(this.tmpVec);
    const fwd = this.forwardDirection();
    const c = new THREE.Vector3();
    const to = new THREE.Vector3();
    for (const animal of WildAnimal.alive) {
      if (animal.dead) continue;
      animal.getHitCenter(c);
      to.copy(c).sub(origin);
      to.y = 0;
      const dist = to.length();
      if (dist > MELEE_REACH + animal.getHitRadius()) continue;
      if (dist > 1e-4 && to.normalize().dot(fwd) < MELEE_FRONT_DOT) continue; // behind the pawn — miss
      animal.takeDamage(dmg, this);
    }
  }

  /**
   * The world point under the crosshair: raycast from the camera straight through screen-center to
   * the first blocking hit (else a far point along it). This is what the crosshair actually marks.
   */
  private aimTargetPoint(out: THREE.Vector3): THREE.Vector3 {
    const camPos = this.camera ? this.camera.getWorldPosition(new THREE.Vector3()) : this.getWorldPosition(new THREE.Vector3());
    const camDir = this.camera ? this.camera.getWorldDirection(new THREE.Vector3()) : new THREE.Vector3(0, 0, -1);
    const far = 140 * CHARACTER_SCALE;
    const physics = this.getPhysicsEngine();
    if (physics) {
      const hit = physics.raycast({
        origin: camPos,
        direction: camDir,
        maxDistance: far,
        ignoredRootNodes: [this],
      });
      if (hit) return out.copy(hit.hitLocation);
    }
    return out.copy(camPos).addScaledVector(camDir, far);
  }

  /**
   * Launch/aim direction from `spawn` (the weapon tip) toward the crosshair's world target, so the
   * arrow and the trajectory preview both converge on the crosshair instead of running parallel to
   * the camera and drifting away from it.
   */
  private aimDirection(spawn: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const camDir = this.camera ? this.camera.getWorldDirection(new THREE.Vector3()) : new THREE.Vector3(0, 0, -1);
    const dir = this.aimTargetPoint(out).sub(spawn); // out now holds (target - spawn)
    // Guard: at steep angles the crosshair target can resolve behind the muzzle (parallax), which
    // would flip the shot backward — fall back to the camera forward direction instead.
    if (dir.dot(camDir) <= 0.05 || dir.lengthSq() < 1e-8) dir.copy(camDir);
    return dir.normalize();
  }

  /**
   * World position the arrow launches from. For ranged weapons this is the GRIP socket (the hand
   * holding the bow / crossbow) — that's where the arrow actually nocks and leaves, so the preview
   * line starts from the muzzle instead of a stray bow-limb tip. Falls back to the tip, then chest.
   */
  private arrowSpawnPoint(out: THREE.Vector3): THREE.Vector3 {
    if (this.isRanged() && this.equippedId && this.characterMesh) {
      const socketName = WEAPONS[this.equippedId]?.socket === 'left' ? SOCKET_NAME_L : SOCKET_NAME;
      const socket = this.characterMesh.getSocket(socketName) as THREE.Object3D | null;
      if (socket) return socket.getWorldPosition(out);
    }
    const tip = this.currentWeaponTip();
    if (tip) return tip.getWorldPosition(out);
    this.getWorldPosition(out);
    out.y += 0.9 * CHARACTER_SCALE; // roughly chest height
    return out;
  }

  /** The equipped ranged weapon's projectile/charge tuning, if any. */
  private rangedStats(): RangedStats | undefined {
    return this.equippedId && this.isRanged() ? WEAPONS[this.equippedId]?.rangedStats : undefined;
  }

  /** Fire a ballistic arrow along the current aim. Charge scales speed (flatness/range) + accuracy. */
  private fireArrow(): void {
    const world = this.getWorld();
    if (!world) return;
    Sfx.play('bowFire', 0.8);
    if (!UNLIMITED_ARROWS) this.inventory?.consumeStack('arrow'); // spend one arrow per shot
    const rs = this.rangedStats();
    const spawnPos = this.arrowSpawnPoint(new THREE.Vector3());
    const dir = this.aimDirection(spawnPos, new THREE.Vector3());

    // Charge → faster/flatter shot and tighter spread (0 spread at full draw).
    const speed = rs ? THREE.MathUtils.lerp(rs.minSpeed, rs.maxSpeed, this.charge01) : ARROW.speed;
    const gravity = rs?.gravity ?? ARROW.gravity;
    const maxDist = rs?.maxDistance ?? ARROW.maxDistance;
    if (rs) this.applySpread(dir, rs.maxSpreadDeg * (1 - this.charge01));

    const velocity = dir.multiplyScalar(speed * CHARACTER_SCALE);
    const damage = ((this.equippedId ? WEAPONS[this.equippedId]?.damage : undefined) ?? ARROW.damage) * this.damageMult;
    // Fly it here at once (no lag for the shooter); in co-op the server relays it to everyone and
    // its own copy is the one that deals the damage.
    this.spawnArrowLocal(spawnPos, velocity, gravity * CHARACTER_SCALE, maxDist * CHARACTER_SCALE, damage);
    if (isOnline()) this.serverFireArrow(spawnPos, velocity, gravity * CHARACTER_SCALE, maxDist * CHARACTER_SCALE, damage);
  }

  /** Randomly deflect a unit direction within a cone of `spreadDeg` half-angle (0 = no deflection). */
  private applySpread(dir: THREE.Vector3, spreadDeg: number): void {
    if (spreadDeg <= 0) return;
    const s = THREE.MathUtils.degToRad(spreadDeg);
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(dir, up).normalize();
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    dir.applyAxisAngle(up, (Math.random() * 2 - 1) * s);      // yaw jitter
    dir.applyAxisAngle(right, (Math.random() * 2 - 1) * s);   // pitch jitter
    dir.normalize();
  }

  /** Advance the ranged charge (built while aiming) and drive the charge bar. */
  private updateCharge(deltaTime: number): void {
    if (this.fireCdTimer > 0) this.fireCdTimer = Math.max(0, this.fireCdTimer - deltaTime);
    const rs = this.rangedStats();
    if (rs && this.aiming && this.fireCdTimer <= 0) {
      const wasZero = this.chargeTimer <= 0;
      this.chargeTimer = Math.min(rs.chargeTime, this.chargeTimer + deltaTime);
      if (wasZero && this.chargeTimer > 0) Sfx.play('bowCharge', 0.7); // each fresh draw (aim start + after every shot)
    } else if (!this.aiming || !rs) {
      this.chargeTimer = 0;
    }
    this.charge01 = rs ? this.chargeTimer / rs.chargeTime : 0;
    this.chargeBar?.set(rs && this.aiming ? this.charge01 : -1);
  }

  /**
   * Redraw the ballistic aim preview while aiming (same integration the arrow uses), stepping the
   * arc until it hits geometry (the line stops at the first blocking hit) or runs out of range.
   * Hidden when not aiming.
   */
  private updateTrajectory(): void {
    this.crosshair?.setShown(this.aiming);
    if (!this.trajectory) return;
    if (!this.aiming) { this.trajectory.setShown(false); return; }

    const rs = this.rangedStats();
    const cur = this.arrowSpawnPoint(new THREE.Vector3());
    // Preview the CENTER shot at the current charge — the arc flattens as it charges (speed rises).
    const speed = rs ? THREE.MathUtils.lerp(rs.minSpeed, rs.maxSpeed, this.charge01) : ARROW.speed;
    const vel = this.aimDirection(cur, new THREE.Vector3()).multiplyScalar(speed * CHARACTER_SCALE);
    const g = (rs?.gravity ?? ARROW.gravity) * CHARACTER_SCALE;
    const maxDist = (rs?.maxDistance ?? ARROW.maxDistance) * CHARACTER_SCALE;
    // Fine enough + enough steps to reach the arrow's full range (else the line stops mid-air before
    // the real landing). Same gravity/speed/raycast as the arrow, so the end = the true impact point.
    const dt = 0.05;
    const physics = this.getPhysicsEngine();

    const points: THREE.Vector3[] = [cur.clone()];
    let travelled = 0;
    const next = new THREE.Vector3();
    const seg = new THREE.Vector3();
    for (let i = 0; i < 160; i++) {
      // Same order as ArrowProjectile.tickPrePhysics (gravity first, then step) so the
      // preview matches the real shot.
      vel.y -= g * dt;
      next.copy(cur).addScaledVector(vel, dt);
      seg.copy(next).sub(cur);
      const segLen = seg.length();
      if (physics && segLen > 1e-5) {
        const hit = physics.raycast({
          origin: cur,
          direction: seg.clone().normalize(),
          maxDistance: segLen,
          ignoredRootNodes: [this],
        });
        if (hit) {
          points.push(hit.hitLocation.clone());
          break;
        }
      }
      points.push(next.clone());
      travelled += segLen;
      cur.copy(next);
      if (travelled >= maxDist) break;
    }
    this.trajectory.update(points);
    this.trajectory.setShown(true);
  }

  /** Resolve the torso bones once the character model has loaded. */
  private resolveTorsoBones(): void {
    if (this.torsoResolved || !this.characterMesh) return;
    const spine = this.characterMesh.getObjectByName('spine');
    const chest = this.characterMesh.getObjectByName('chest');
    if (spine || chest) {
      this.spineBone = spine ?? null;
      this.chestBone = chest ?? null;
      this.spineBaseX = spine ? spine.rotation.x : 0;
      this.chestBaseX = chest ? chest.rotation.x : 0;
      this.torsoResolved = true;
    }
  }

  /**
   * Bend the upper body (spine + chest) to follow the aim pitch while aiming, so the torso and the
   * held weapon tilt up/down with the crosshair. Applied AFTER the animation has posed the skeleton
   * (tickPostPhysics), additively, and eased by aimBlend. Hips/legs are untouched.
   */
  private applyTorsoAim(): void {
    this.resolveTorsoBones();
    // Only drive the spine while aiming; otherwise leave the bones to the animation.
    if (this.aimBlend < 0.02) return;
    // Clamp the pitch so a steep look can't wind the spine past a natural bend (no spinning).
    const p = THREE.MathUtils.clamp(this.camPitch, -TORSO_PITCH_LIMIT, TORSO_PITCH_LIMIT);
    const bend = this.aimBlend * p;
    // SET absolute (base + bend), never += — the aim pose is a frozen clip so the mixer stops
    // rewriting these bones, and accumulating would spin them. Minus sign flips the invert.
    if (this.spineBone) this.spineBone.rotation.x = this.spineBaseX - bend * SPINE_PITCH_FACTOR;
    if (this.chestBone) this.chestBone.rotation.x = this.chestBaseX - bend * CHEST_PITCH_FACTOR;
  }

  //====================================================================================================
  // Dodge roll
  //====================================================================================================

  private triggerDodge(): void {
    if (this.isDead || this.shopOpen || this.backpackOpen || this.drinking) return;
    if (!this.animationNode?.isReady() || this.dodgeCooldown > 0) return;
    const mn = this.movementNode;
    if (mn instanceof ENGINE.CharacterMovementNode && !mn.isGrounded) return; // ground only
    const st = this.animationNode.getGraphState('base') ?? '';
    if (DODGE_STATES.has(st) || ATTACK_STATES.has(st) || st === 'pickup') return;
    Sfx.play('dash', 0.7);

    // Input direction relative to the camera, projected onto the character's facing.
    const camQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.camYaw, 0, 'YXZ'));
    const camFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camQuat);
    const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camQuat);
    const dir = camFwd.multiplyScalar(this.inForward).add(camRight.multiplyScalar(this.inRight));
    dir.y = 0;

    let lf: number, lr: number;
    if (dir.lengthSq() < 1e-6) {
      lf = 1; lr = 0; // no input -> roll toward facing (forward)
    } else {
      dir.normalize();
      lf = dir.dot(this.forwardDirection());
      lr = dir.dot(this.rightDirection());
    }

    if (Math.abs(lf) >= Math.abs(lr)) {
      this.dodgeDir = lf >= 0 ? 0 : 1; // F / B
      this.dodgeFwd = lf >= 0 ? 1 : -1; this.dodgeRight = 0;
    } else {
      this.dodgeDir = lr >= 0 ? 3 : 2; // R / L
      this.dodgeRight = lr >= 0 ? 1 : -1; this.dodgeFwd = 0;
    }

    this.dodgePulse = 2;
    this.dodgeTimer = DODGE_DURATION;
    this.dodgeElapsed = 0;
    this.dodgeCooldown = DODGE_COOLDOWN;

    // Straight dust streak along the dash direction: orient the dash-dust node so its local
    // forward (-Z) aligns with the dash, then fire the one-shot burst (trails backward).
    if (this.dashDust) {
      this.dashDust.rotation.y = Math.atan2(-this.dodgeRight, this.dodgeFwd);
      // VFXNode doesn't forward `useLocalDirection` to the emitter core, so directions stay
      // world-space (streak locks to one world axis). Force local-direction on the cores and
      // refresh the world matrix so the emit uses the node's current orientation.
      this.dashDust.updateMatrixWorld(true);
      for (const c of this.dashDust.children) {
        (c as unknown as { localDirection?: boolean }).localDirection = true;
      }
      this.dashDust.startEmitting(true);
    }
  }

  //====================================================================================================
  // Input capture (called by DefaultPlayerController each frame)
  //====================================================================================================

  // Capture movement intent instead of feeding the movement node directly — we translate it into
  // an orient-to-movement heading in tickPrePhysics.
  public override moveForward(value: number): void { this.inForward = value; }
  public override moveRight(value: number): void { this.inRight = value; }

  // Capture look deltas for free-look instead of rotating the character / camera pitch directly.
  public override lookRight(value: number): void { this.freeLookYaw += value; }
  public override lookUp(value: number): void { this.freeLookPitch += value; }

  // Block jump input while airborne (no accidental re-trigger / animation reset).
  public override jump(strength: number = 1): void {
    if (this.isDead || this.shopOpen || this.backpackOpen) return;
    const mn = this.movementNode;
    if (mn instanceof ENGINE.CharacterMovementNode && !mn.canGroundJump) return;
    this.burstDust?.startEmitting(true); // dust puff on takeoff
    super.jump(strength);
  }

  /** After the animation has posed the skeleton, bend the torso to follow the aim pitch. */
  public override tickPostPhysics(deltaTime: number): void {
    super.tickPostPhysics(deltaTime);
    this.applyTorsoAim();
    if (this.isLocalOwner()) this.clampCameraAboveGround();
  }

  /**
   * Hard floor for the camera: after the spring arm has placed it, if the camera dipped below the
   * ground, raise the whole ORBIT (pivot) vertically by the shortfall. Because the pivot's parent
   * only yaws, this is a pure world-vertical lift — the horizontal distance to the character is
   * unchanged, so it does NOT zoom. Direction-agnostic anti-clip.
   */
  private clampCameraAboveGround(): void {
    if (!this.camera || !this.cameraPivot) return;
    const physics = this.getPhysicsEngine();
    if (!physics) return;
    this.camera.updateWorldMatrix(true, false); // ensure the spring-arm placement is reflected
    const camPos = this.camera.getWorldPosition(this.tmpVec);
    const up = 8 * CHARACTER_SCALE;
    const hit = physics.raycast({
      origin: new THREE.Vector3(camPos.x, camPos.y + up, camPos.z),
      direction: new THREE.Vector3(0, -1, 0),
      maxDistance: up + 40 * CHARACTER_SCALE,
      ignoredRootNodes: [this],
    });
    if (!hit) return;
    const floorY = hit.hitLocation.y + CAM_GROUND_MARGIN;
    if (camPos.y >= floorY) return;
    // Raise the orbit vertically by the shortfall (applies next frame). Pure up = no zoom.
    this.cameraPivot.position.y += floorY - camPos.y;
  }

  //====================================================================================================
  // Orientation + movement
  //====================================================================================================

  public override tickPrePhysics(deltaTime: number): void {
    if (!this.isLocalOwner()) {
      this.tickRemote(deltaTime);
      return;
    }
    if (!this.camInitialized) {
      this.camYaw = this.rotation.y;
      this.camPitch = this.cameraPivot ? this.cameraPivot.rotation.x : 0;
      this.camInitialized = true;
    }

    // Apply per-clip playback speeds once the actions exist.
    if (!this.pickupSpeedApplied && this.animationNode?.isReady()) {
      const actions = this.animationNode.getActionsMap();
      const pu = actions.get('PickUp');
      if (pu) { pu.timeScale = PICKUP_SPEED; this.pickupSpeedApplied = true; }
      const drink = actions.get('Use_Item');
      if (drink) drink.timeScale = DRINK_CLIP_SPEED; // stretch the drink to ~3s
      for (const clip of ['Dodge_Forward', 'Dodge_Backward', 'Dodge_Left', 'Dodge_Right']) {
        const a = actions.get(clip);
        if (a) a.timeScale = DODGE_CLIP_SPEED;
      }
    }

    // Retry equipping if the socket wasn't ready when the slot was selected.
    if (this.armed && this.equippedId && !this.weaponNodes.has(this.equippedId)) this.applyWeapon();

    if (this.attackCooldown > 0) this.attackCooldown = Math.max(0, this.attackCooldown - deltaTime);
    if (this.dodgeCooldown > 0) this.dodgeCooldown = Math.max(0, this.dodgeCooldown - deltaTime);
    // Land the melee hit at the swing's strike frame (once), not on the click.
    if (this.meleeStrikeTimer > 0) {
      this.meleeStrikeTimer -= deltaTime;
      if (this.meleeStrikeTimer <= 0) {
        this.meleeStrikeTimer = -1;
        if (!this.isDead && !this.drinking) this.serverMelee(this.currentMeleeDamage());
      }
    }

    const mn = this.movementNode;
    const baseState = this.animationNode?.getGraphState('base') ?? '';
    const inAttack = ATTACK_STATES.has(baseState);
    const inPickup = baseState === 'pickup';
    const inDodge = DODGE_STATES.has(baseState);
    // Aim mode: holding RMB with a ranged weapon equipped (and not busy/dead).
    this.aiming = this.rmbHeld && this.isRanged() && !this.isDead && !this.shopOpen && !this.backpackOpen;

    // Invincibility is only ever on during the dodge window.
    this.invincible = inDodge && this.dodgeElapsed >= IFRAME_START && this.dodgeElapsed <= IFRAME_END;

    // Track the last safe ground position (grounded, above water, alive) for respawn, and kill the
    // pawn the instant its body dips below the deadly water surface.
    if (mn instanceof ENGINE.CharacterMovementNode && !this.isDead) {
      const bodyY = this.getWorldPosition(this.tmpVec).y;
      const aboveWater = this.waterSurfaceY === null || bodyY > this.waterSurfaceY + WATER_DEATH_DEPTH;
      if (mn.isGrounded && aboveWater) {
        this.lastSafeGround.copy(this.tmpVec);
        this.hasSafeGround = true;
        // Remember which way we were heading, so respawn can step back inland (opposite it).
        const vel = mn.getVelocities();
        const fwd = this.forwardDirection();
        const rgt = this.rightDirection();
        const dx = fwd.x * vel.forward + rgt.x * vel.right;
        const dz = fwd.z * vel.forward + rgt.z * vel.right;
        const len = Math.hypot(dx, dz);
        if (len > 0.05) this.lastSafeDir.set(dx / len, 0, dz / len);
      }
      // Solo decides the water death here; in co-op the server's copy of this pawn does (tickRemote).
      if (this.waterSurfaceY !== null && bodyY < this.waterSurfaceY - WATER_DEATH_DEPTH && this.hasAuthority()) {
        this.killByWater();
      }
    }

    // Look sensitivity from settings — aiming uses its own (usually lower) value.
    const settings = getSettings();
    ENGINE.DefaultPlayerController.inputSettings.lookSensitivity = this.aiming ? settings.aimSensitivity : settings.tpSensitivity;

    if (this.isDead || this.shopOpen || this.shopCamReturning || this.backpackOpen || this.storeOpen || this.drinking || this.paused || this.preloading) {
      // Frozen: death fade, an open menu, the camera return, drinking a potion, pause, or preloading.
      if (mn) { mn.addForwardInput(0); mn.addRightInput(0); mn.addLookRightInput(0); }
      // Kill any residual planar velocity so the pawn doesn't coast/slide while rooted.
      if (this.drinking && mn instanceof ENGINE.CharacterMovementNode) {
        const v = mn.getVelocities();
        mn.setVelocities(0, 0, v.vertical < 0 ? v.vertical : 0);
      }
    } else if (mn && this.knockbackTimer > 0) {
      // Knocked back: a short decaying burst away from the attacker (overrides normal control).
      this.knockbackTimer -= deltaTime;
      const decay = Math.max(0, this.knockbackTimer / KNOCKBACK_DURATION);
      if (mn instanceof ENGINE.CharacterMovementNode && mn.maxSpeed > 0) {
        mn.speedModifier = this.knockbackSpeed / mn.maxSpeed;
      }
      const fwd = this.forwardDirection();
      const right = this.rightDirection();
      mn.addForwardInput(this.knockbackDir.dot(fwd) * decay);
      mn.addRightInput(this.knockbackDir.dot(right) * decay);
      mn.addLookRightInput(0);
      if (this.knockbackTimer <= 0 && mn instanceof ENGINE.CharacterMovementNode) mn.speedModifier = 1;
    } else if (mn && this.aiming) {
      // Aim mode: the body always faces the camera yaw (so the aim stays on the crosshair) while the
      // legs STRAFE in the input direction — feed camera-relative input as local forward/right so the
      // base locomotion blendspace plays the matching strafe clip. The upper body aim pose comes from
      // the masked aim layer, and the torso pitch bend follows the aim up/down.
      const diff = shortestAngle(this.rotation.y, this.camYaw);
      const aimTurn = THREE.MathUtils.clamp(diff, -AIM_TURN_RATE * deltaTime, AIM_TURN_RATE * deltaTime);
      const camQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.camYaw, 0, 'YXZ'));
      const camFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camQuat);
      const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camQuat);
      const worldDir = camFwd.multiplyScalar(this.inForward).add(camRight.multiplyScalar(this.inRight));
      worldDir.y = 0;
      // Project the desired world move onto the character's own facing to get strafe inputs.
      const charFwd = this.forwardDirection();
      const charRight = this.rightDirection();
      mn.addForwardInput(THREE.MathUtils.clamp(worldDir.dot(charFwd), -1, 1) * AIM_SPEED_MULT);
      mn.addRightInput(THREE.MathUtils.clamp(worldDir.dot(charRight), -1, 1) * AIM_SPEED_MULT);
      this.addTurnInput(mn, aimTurn);
    } else if (mn && inDodge) {
      // Input-driven dash: temporarily raise the movement speed cap and feed a decaying
      // directional input. Staying input-driven keeps client prediction/reconciliation
      // consistent (setVelocities would get replayed away, snapping the character back).
      let decay = 0;
      if (this.dodgeTimer > 0) {
        decay = this.dodgeTimer / DODGE_DURATION;
        this.dodgeTimer = Math.max(0, this.dodgeTimer - deltaTime);
      }
      this.dodgeElapsed += deltaTime;
      if (mn instanceof ENGINE.CharacterMovementNode && mn.maxSpeed > 0) {
        mn.speedModifier = DASH_SPEED / mn.maxSpeed;
      }
      mn.addForwardInput(this.dodgeFwd * decay);
      mn.addRightInput(this.dodgeRight * decay);
      mn.addLookRightInput(0);
    } else if (mn && inAttack) {
      // Attack lunge: a small decaying forward step along the current facing. Player steering
      // is locked during the swing.
      let f = 0;
      if (this.lungeTimer > 0) {
        f = LUNGE_INPUT * (this.lungeTimer / LUNGE_DURATION);
        this.lungeTimer = Math.max(0, this.lungeTimer - deltaTime);
      }
      mn.addForwardInput(f);
      mn.addRightInput(0);
      mn.addLookRightInput(0);
    } else if (mn && inPickup) {
      // Locked in place during pickup.
      mn.addForwardInput(0);
      mn.addRightInput(0);
      mn.addLookRightInput(0);
    } else if (mn) {
      let turn = 0;
      const mag = Math.min(1, Math.hypot(this.inForward, this.inRight));
      if (mag > 0.01) {
        // Desired world direction = camera basis applied to the input vector.
        const camQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.camYaw, 0, 'YXZ'));
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camQuat);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camQuat);
        const dir = fwd.multiplyScalar(this.inForward).add(right.multiplyScalar(this.inRight));
        dir.y = 0;

        if (dir.lengthSq() > 1e-6) {
          dir.normalize();
          const targetYaw = Math.atan2(-dir.x, -dir.z);
          const diff = shortestAngle(this.rotation.y, targetYaw);

          // Quick pivot toward the target heading.
          turn = THREE.MathUtils.clamp(diff, -TURN_RATE * deltaTime, TURN_RATE * deltaTime);

          // Pivot first, run once aligned.
          const align = Math.cos(diff);
          const speedFactor = mag * THREE.MathUtils.clamp((align - ALIGN_MIN) / (1 - ALIGN_MIN), 0, 1);
          mn.addForwardInput(speedFactor);
        } else {
          mn.addForwardInput(0);
        }
      } else {
        mn.addForwardInput(0);
      }
      // We drive heading ourselves (as a yaw input, so co-op replays it) — never strafe.
      mn.addRightInput(0);
      this.addTurnInput(mn, turn);
    }

    // Restore the normal speed cap the moment the dodge ends.
    if (mn instanceof ENGINE.CharacterMovementNode && this.wasDodging && !inDodge) {
      mn.speedModifier = 1;
    }
    this.wasDodging = inDodge;

    // Foot dust: loop while moving on the ground, one-shot puff on landing.
    if (mn instanceof ENGINE.CharacterMovementNode && !this.isDead) {
      const grounded = mn.isGrounded;
      const v = mn.getVelocities();
      const planar = Math.hypot(v.forward, v.right);
      const moving = grounded && planar > DUST_MIN_SPEED && !inDodge;
      if (moving && !this.dustEmitting) { this.runDust?.startEmitting(); this.dustEmitting = true; }
      else if (!moving && this.dustEmitting) { this.runDust?.stopEmitting(); this.dustEmitting = false; }
      // Footstep SFX cadence while moving.
      if (moving) {
        this.footstepTimer -= deltaTime;
        if (this.footstepTimer <= 0) {
          Sfx.play('footstep', 0.28); // single grass step
          this.footstepTimer = 0.34;
        }
      } else {
        this.footstepTimer = 0;
      }
      if (!this.wasGrounded && grounded) this.burstDust?.startEmitting(true); // landing puff
      this.wasGrounded = grounded;

      // Velocity sanitize (skip during dodge, which drives its own forward/right burst):
      //  - force rightVelocity = 0: we never strafe, so kill any lateral drift the controller
      //    slide/collision response injects (the "pushed left while walking" bug).
      //  - clamp downward gravity build-up while grounded so it doesn't oscillate vs snap.
      // Skip during dodge/knockback (own burst) and while aiming (strafing NEEDS lateral velocity).
      if (!inDodge && !this.aiming && this.knockbackTimer <= 0) {
        const vert = (grounded && v.vertical < 0) ? 0 : v.vertical;
        if (v.right !== 0 || vert !== v.vertical) mn.setVelocities(v.forward, 0, vert);
      } else if (this.aiming) {
        // Aiming: keep lateral velocity for strafing, but still clamp grounded downward drift.
        const vert = (grounded && v.vertical < 0) ? 0 : v.vertical;
        if (vert !== v.vertical) mn.setVelocities(v.forward, v.right, vert);
      }
    }

    // Weapon slash trail: one fresh trail per swing (dagger only). It captures for
    // TRAIL_CAPTURE_TIME then ends, so the tail fades out over the last moments of the swing.
    const weaponTip = this.currentWeaponTip();
    if (inAttack && this.armed && !this.isRanged() && weaponTip) {
      if (this.comboStep !== this.lastTrailCombo) {
        const width = (this.equippedId ? WEAPONS[this.equippedId]?.trailWidth : undefined) ?? 0.18;
        this.trail?.begin(weaponTip, width * CHARACTER_SCALE);
        this.trailCaptureTimer = TRAIL_CAPTURE_TIME;
        this.lastTrailCombo = this.comboStep;
      }
      if (this.trailCaptureTimer > 0) {
        this.trailCaptureTimer -= deltaTime;
        if (this.trailCaptureTimer <= 0) this.trail?.end();
      }
    } else {
      if (this.wasAttacking) this.trail?.end();
      this.lastTrailCombo = -1;
    }
    this.wasAttacking = inAttack && this.armed;

    // Runs updateCamera + animation parameter update (isRunning/isJumping/forward/...).
    super.tickPrePhysics(deltaTime);

    // Ranged charge (built while aiming) — must run before the trajectory so the preview reflects it.
    this.updateCharge(deltaTime);
    // Aim trajectory preview (uses the camera yaw/pitch just refreshed by updateCamera).
    this.updateTrajectory();
    this.syncToServer();

    // Interaction prompt: a kill loot-toast takes priority, else the nearest interactable's prompt
    // (both hidden while dead or shopping).
    if (this.interactPrompt) {
      let prompt = '';
      if (!this.isDead && !this.shopOpen && !this.shopCamReturning && !this.backpackOpen) {
        const loot = this.nearestLoot();
        prompt = loot?.item
          ? `F to pick up ${loot.item.name}`
          : (this.getInteractionNode()?.getCurrentPrompt() ?? '');
      }
      this.interactPrompt.set(prompt);
    }

    // Potion drink sequence (held bottle + Use_Item one-shot + delayed effect).
    this.updateDrink(deltaTime);
    // Timed potion effects + HUD.
    this.updateEffects(deltaTime);
    this.updateStatusHUD();
    this.updateAmbientAudio(deltaTime);

    // Feed one-shot / combat parameters to the state machine.
    if (this.animationNode && this.animationNode.isReady()) {
      this.animationNode.setParameter('doPickup', this.pickupPulse > 0);
      if (this.pickupPulse > 0) this.pickupPulse--;

      this.animationNode.setParameter('doDrink', this.drinkPulse > 0);
      if (this.drinkPulse > 0) this.drinkPulse--;

      this.animationNode.setParameter('armed', this.armed);
      this.animationNode.setParameter('twoHand', this.isTwoHand());
      this.animationNode.setParameter('ranged', this.isRanged());
      this.animationNode.setParameter('aiming', this.aiming);
      this.animationNode.setParameter('attack', this.attackPulse > 0);
      this.animationNode.setParameter('comboStep', this.comboStep);
      if (this.attackPulse > 0) this.attackPulse--;

      this.animationNode.setParameter('dodgeDir', this.dodgeDir);
      this.animationNode.setParameter('dodge', this.dodgePulse > 0);
      if (this.dodgePulse > 0) this.dodgePulse--;

      // Masked aim layer: fade the upper-body aim pose in/out and pick the bow vs 1H aim state.
      const wantAim = this.aiming ? (this.isTwoHand() ? 'aim_bow' : 'aim_1h') : null;
      if (wantAim && wantAim !== this.aimLayerState) {
        this.animationNode.transitionGraphToState('layer', wantAim);
        this.aimLayerState = wantAim;
      } else if (!wantAim && this.aimLayerState) {
        this.animationNode.transitionGraphToState('layer', 'rest');
        this.aimLayerState = null;
      }
      const targetW = this.aiming ? 1 : 0;
      this.aimLayerWeight += (targetW - this.aimLayerWeight) * Math.min(1, AIM_BLEND_RATE * deltaTime);
      this.animationNode.setGraphWeight('layer', this.aimLayerWeight);

      // Reset the combo once we're back out of the attack states (and not mid-trigger).
      const st = this.animationNode.getGraphState('base') ?? '';
      if (!ATTACK_STATES.has(st) && this.attackPulse <= 0) this.comboStep = 0;
    }
  }

  /**
   * Turn the body by `yawDelta` radians through the movement node instead of writing rotation.y, so
   * the turn is part of the input the co-op server replays (otherwise the server would keep the old
   * heading and pull the player back). Absolute look input rotates by value * lookRightSpeed, and a
   * positive look-right turns clockwise (negative yaw).
   */
  private addTurnInput(mn: ENGINE.BasePawnMovementNode, yawDelta: number): void {
    const speed = mn instanceof ENGINE.CharacterMovementNode ? mn.lookRightSpeed : 0;
    if (speed > 0 && yawDelta !== 0) mn.addLookRightInput(-yawDelta / speed, true);
    else mn.addLookRightInput(0);
  }

  //====================================================================================================
  // Camera: world-fixed yaw, mouse free-look only while RMB is held
  //====================================================================================================

  protected override updateCamera(deltaTime: number): void {
    // Shop "trade shot": drive the camera's world transform directly, lerping to the framed target.
    if (this.shopCamActive && this.camera) {
      const t = Math.min(1, this.shopCamLerp * deltaTime);
      this.shopCamPos.lerp(this.shopCamTargetPos, t);
      this.shopCamQuat.slerp(this.shopCamTargetQuat, t);
      this.shopCamMat.compose(this.shopCamPos, this.shopCamQuat, ONE_SCALE);
      this.camera.matrixWorld.copy(this.shopCamMat);
      this.camera.matrixWorldInverse.copy(this.shopCamMat).invert();
      return;
    }

    // Transitioning back to third-person after closing the shop.
    if (this.shopCamReturning) {
      this.updateShopCamReturn(deltaTime);
      return;
    }

    this.applyFollowRig(deltaTime);
  }

  /** Normal third-person follow rig: free-look while RMB held, pivot counter-rotates the char yaw. */
  private applyFollowRig(deltaTime = 0): void {
    const pivot = this.cameraPivot;
    if (!pivot) return;

    // Ease the camera into an over-shoulder aim while a ranged weapon is aimed, back out otherwise.
    // The follow distance lives on the SPRING ARM (armLength), and the camera sits at the arm's end
    // (local ~0); so we dolly via armLength and offset sideways via the camera's own local x.
    if (this.camera && this.springArm) {
      if (!this.camBaseCam) this.camBaseCam = this.camera.position.clone();
      const b = this.camBaseCam;
      // Capture the current follow distance the moment aim begins, so we lerp from whatever the
      // player scrolled to — and so we never fight the scroll-zoom while NOT aiming.
      if (this.aiming && !this.aimWasActive) {
        this.preAimArm = this.springArm.armLength ?? this.springArm.getBaselineDistance() ?? 5;
      }
      this.aimWasActive = this.aiming;
      const target = this.aiming ? 1 : 0;
      this.aimBlend += (target - this.aimBlend) * Math.min(1, AIM_BLEND_RATE * deltaTime);

      // The aim camera is a FIXED-distance over-shoulder shot — it must never zoom as you look
      // around. So disable the spring-arm collision pull-in for the whole aim (and the ease-out),
      // re-enabling only once fully restored to the pre-aim distance (so exiting can't snap in from
      // inside geometry). A raised orbit pivot keeps looking UP from dipping the camera into ground.
      this.springArm.collisionEnabled = !this.aiming && this.aimBlend < 0.005;
      if (this.pivotBaseY === null) this.pivotBaseY = pivot.position.y;
      // Raise the pivot in proportion to how far UP you're looking (0 when level/down). In normal
      // TPS this lifts the orbit above the body so looking up can't swing the arm through the
      // character; aiming adds extra lift to also clear the ground. Level/forward stays normal.
      // Looking UP is a NEGATIVE camPitch (pivot.rotation.x), and the up extreme is
      // cameraMinPitchDegrees (the most-negative pitch). Normalise against it so upAmt is 0 when
      // level/down and 1 at full look-up.
      const upLimit = THREE.MathUtils.degToRad(this.cameraMinPitchDegrees);
      const upAmt = Math.abs(upLimit) > 1e-4 ? THREE.MathUtils.clamp(this.camPitch / upLimit, 0, 1) : 0;
      // Lift the pivot only on look-up (keeps the arm from swinging through the body); aiming adds
      // a bit more. Ground clipping is handled separately by clampCameraAboveGround().
      pivot.position.y = this.pivotBaseY + (TPS_UP_RAISE + AIM_PIVOT_RAISE * this.aimBlend) * upAmt;

      if (this.aiming || this.aimBlend > 0.001) {
        // FIXED tight over-shoulder: lerp from the pre-aim (scrolled) distance to a constant close
        // arm + a constant right/up offset — so the framing is the same tight shot every time,
        // regardless of scroll or how the aim is guided near walls.
        this.springArm.armLength = THREE.MathUtils.lerp(this.preAimArm, AIM_ARM, this.aimBlend);
        this.camera.position.x = b.x + THREE.MathUtils.lerp(0, AIM_SHOULDER, this.aimBlend);
        this.camera.position.y = b.y + THREE.MathUtils.lerp(0, AIM_RAISE, this.aimBlend);
      } else {
        // Not aiming: leave armLength to the engine scroll-zoom, keep the camera centered.
        // NOTE: scroll-zoom intentionally does nothing WHILE aiming (the aim blend owns
        // armLength there) — by design, not a bug.
        this.camera.position.x = b.x;
        this.camera.position.y = b.y;
      }
    }

    if (this.middleHeld || this.aiming) {
      const yawSign = INVERT_FREE_LOOK_YAW ? -1 : 1;
      const pitchSign = INVERT_FREE_LOOK_PITCH ? -1 : 1;
      this.camYaw += yawSign * this.freeLookYaw * FREE_LOOK_SENS;
      const minPitch = THREE.MathUtils.degToRad(this.cameraMinPitchDegrees);
      const maxPitch = THREE.MathUtils.degToRad(this.cameraMaxPitchDegrees);
      this.camPitch = THREE.MathUtils.clamp(this.camPitch + pitchSign * this.freeLookPitch * FREE_LOOK_SENS, minPitch, maxPitch);
    }
    // Deltas are consumed (or discarded when RMB is up) every frame.
    this.freeLookYaw = 0;
    this.freeLookPitch = 0;

    // Counter-rotate the pivot by the character's yaw so the camera keeps a fixed world yaw
    // while the character (pawn root) turns to face its movement direction.
    pivot.rotation.order = 'YXZ';
    pivot.rotation.y = this.camYaw - this.rotation.y;
    pivot.rotation.x = this.camPitch;
  }
}
