/**
 * The store's single source of truth. Engine-free: UI components render
 * `state` and call the actions; game code listens to the events.
 *
 * Everything goes through the page's store host (store-client.ts). The host
 * signs the player in, confirms purchases and decides real or Test Silicon;
 * the controller shows what it answers and never repeats a purchase.
 */
import {
  StoreApiError,
  type Balance,
  type BalanceChangeReason,
  type Currency,
  type GameItem,
  type HeldItem,
  type InventoryItem,
  type SessionInfo,
  type StoreClient,
} from './store-client.js';
import { resolveGameId, type GameIdSource } from './store-config.js';

/**
 * `unavailable`: the page has no store host, the Play page must be opened in its own tab, or core does not know
 * the game. `unlinked`: desktop Play's project has no linked game. `not-owner`: desktop Play of a game the
 * signed-in creator does not own; unlike `unavailable` it recovers when the account changes.
 */
export type StorePhase = 'unavailable' | 'unlinked' | 'not-owner' | 'loading' | 'guest' | 'ready' | 'empty' | 'error';
export type StoreTab = 'shop' | 'inventory';
export type ItemAction = 'buy' | 'buy-again' | 'claim' | 'owned' | 'processing';

export interface ItemView extends GameItem {
  owned: boolean;
  quantity: number;
  action: ItemAction;
}

export interface StoreError {
  code: string;
  /** Player-facing text, from `storeErrorMessage`. */
  message: string;
}

export interface StoreState {
  phase: StorePhase;
  isOpen: boolean;
  activeTab: StoreTab;
  /** null with `host`: desktop Play's host serves the project's linked game and does not name it. */
  gameId: string | null;
  /** `host` is named here too: a game updated from an earlier store keeps a store-config.ts without it. */
  gameIdSource: GameIdSource | 'host';
  gameIdMismatch: boolean;
  /** Whether the host says a player is signed in; null before its first answer. */
  session: SessionInfo | null;
  balance: number | null;
  /** coins (Silicon), or test-coins (Test Silicon) when the host plays with test money. The host decides. */
  currency: Currency;
  items: ItemView[];
  inventory: InventoryItem[];
  busyItemId: string | null;
  /**
   * Purchases still being processed: the host answered pending, or gave no
   * readable answer. Their cards show Processing… instead of Buy; each settles
   * when the inventory shows the item. They last for the session, across a
   * sign-out and a change of account; the guest view does not list them.
   */
  pendingItemIds: string[];
  /**
   * The pending purchases whose 10 minutes of reads passed without the item
   * arriving. They stay Processing… for the session; the notice asks the
   * player to check the inventory and balance before buying again.
   */
  unconfirmedItemIds: string[];
  /** Get Silicon was asked of the host; cleared when the balance changes, the panel closes, or Test Silicon's 15 s end. */
  awaitingTopUp: boolean;
  /** Silicon missing for the last purchase; the panel offers Get Silicon. Cleared once the balance changes. */
  shortfall: number | null;
  lastError: StoreError | null;
}

export type StoreEvents = {
  state: StoreState;
  /**
   * The store loaded, or the player changed (signed in, signed out, another account) while the game kept
   * running. Apply what the player owns both ways: turn on what `owns()` says, turn off what it no longer does.
   */
  ready: { items: ItemView[]; inventory: InventoryItem[]; balance: number | null };
  /** The item is in the inventory. `orderId` is always null: the host names no order. */
  purchased: { itemId: string; orderId: string | null };
  claimed: { itemId: string };
  /**
   * The purchase is being processed: the host answered pending (`pending`) or
   * gave no readable answer (`no-answer`); it may still go through. Do not
   * grant the item yet: `purchased` or `claimed` follows once the inventory
   * shows it.
   */
  'purchase-pending': { itemId: string; reason: 'pending' | 'no-answer' };
  consumed: { itemId: string; remainingQuantity: number };
  'balance-changed': { amount: number; currency: Currency };
  'needs-coins': { itemId: string; shortfall: number | null };
  /** The player signed in on the host; the store shows their balance and inventory. The host does not say who: both are null. */
  'signed-in': { userId: string | null; username: string | null };
  opened: undefined;
  closed: undefined;
  error: StoreError;
};

export interface StoreControllerDeps {
  client: StoreClient;
  /** From store-config.ts (the project's game id). */
  configuredGameId: string;
  /** From the running game: world.netWorld.gameId ("editor" in the editor). */
  runtimeGameId: string | null | undefined;
  /** Time and timers; the page's own by default. Injected for tests. */
  clock?: StoreClock;
}

/** The controller's time and timers. */
export interface StoreClock {
  now(): number;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const PAGE_CLOCK: StoreClock = {
  now: () => Date.now(),
  setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

type Handler<T> = (payload: T) => void;

/** Reads every 5 s: the first 2 minutes after a purchase goes pending, and while Silicon is on its way. */
const FAST_READS_MS = 5_000;
const FAST_READS_FOR_MS = 2 * 60_000;
/** Then every 30 s. */
const SLOW_READS_MS = 30_000;
/** Reads stop 10 minutes after a purchase went pending, or after Get Silicon. */
const READS_FOR_MS = 10 * 60_000;
/**
 * Test Silicon (desktop Play): Get Test Silicon reads "Adding…" until the new balance is read, for at most 15 s.
 * Then the balance is read once more and the wait ends when that read answers, so the button never sticks when the
 * refill never shows.
 */
const TEST_REFILL_WAIT_MS = 15_000;
/** A guest's Buy or Claim goes on after a sign-in within 10 minutes. */
const CONTINUE_FOR_MS = 10 * 60_000;

/** A purchase still being processed. */
interface PendingPurchase {
  /** Quantity held when it started; re-based after another account. */
  quantityBefore: number;
  /** When it went pending, on the store's clock. */
  since: number;
  /** Its 10 minutes of reads passed without the item arriving. */
  unconfirmed: boolean;
}

const NO_PENDING: ReadonlyMap<string, PendingPurchase> = new Map();

/**
 * Codes after which the store re-reads behind the open cards, so they show what changed (a price, an owner, an item
 * gone). Not REAL_COINS_DISABLED_IN_EDITOR: desktop Play answers it for every published item until the website's update reaches that environment, so a re-read
 * would change nothing and the next press would only get the same answer (Q48).
 */
const RELOAD_AFTER: ReadonlySet<string> = new Set(['PRICE_CHANGED', 'ITEM_NOT_FOUND', 'ALREADY_OWNED', 'ACCOUNT_CHANGED', 'NOT_OWNED']);

/** Desktop Play's line for GAME_NOT_FOUND: the project is linked to a game core does not know (deleted, or another environment's). */
const LINKED_GAME_NOT_FOUND = 'The game this project is linked to was not found. Check the link in Store Manager, then restart Play.';

/**
 * Consume refusals that say for sure nothing was used. Any other failure
 * (UNAVAILABLE, no answer, an unknown code) may hide a use that went through:
 * the store re-reads the inventory to find out, and never invites a retry.
 */
const CONSUME_REFUSED: ReadonlySet<string> = new Set([
  'NOT_OWNED',
  'NOT_CONSUMABLE',
  'INSUFFICIENT_QUANTITY',
  'ITEM_NOT_FOUND',
  'GAME_NOT_FOUND',
  'SIGN_IN_REQUIRED',
  'OPEN_TOP_LEVEL',
  'NO_STORE_HOST',
  'RATE_LIMITED',
  'GAME_NOT_LINKED',
  'NOT_GAME_OWNER',
]);

/**
 * Desktop Play's refusals for this game and account: no linked game, or not the owner. Nothing was sent, and they
 * are not transient: the store shows them instead of its cards until the account changes.
 */
const GATE_CODES: ReadonlySet<string> = new Set(['GAME_NOT_LINKED', 'NOT_GAME_OWNER']);

/**
 * Codes that on a purchase mean "no answer": the purchase may have gone
 * through. The host turns them into a pending result; this is a second guard.
 */
const NO_ANSWER_CODES: ReadonlySet<string> = new Set(['TIMEOUT', 'CLOSED']);

/** The player-facing text for a host code. Unknown codes get a generic line that names the code. */
export function storeErrorMessage(code: string, data: Record<string, unknown> | null = null): string {
  switch (code) {
    case 'NO_STORE_HOST':
      return 'Store unavailable here';
    case 'SIGN_IN_REQUIRED':
      return 'Sign in to buy';
    case 'OPEN_TOP_LEVEL':
      return 'Open the game in its own tab to buy';
    case 'BUSY':
      return 'Your last purchase is still processing. Try again in a moment.';
    case 'PRICE_CHANGED':
      return 'The price of this item changed. Check the new price and buy again if you still want it.';
    case 'INSUFFICIENT_FUNDS':
      return `You do not have enough ${data?.currency === 'test-coins' ? 'Test Silicon' : 'Silicon'} for this item.`;
    case 'ALREADY_OWNED':
      return 'You already own this item.';
    case 'ITEM_NOT_FOUND':
      return 'This item is no longer in the store.';
    case 'NOT_PURCHASABLE':
      return 'This item cannot be bought right now.';
    case 'ACCOUNT_CHANGED':
      return 'You signed in with another account, so nothing was bought. Check the account and try again.';
    case 'UNAVAILABLE':
      return 'The store is not reachable right now. Try again in a moment.';
    case 'ITEM_UNAVAILABLE':
      return "This item isn't available right now.";
    case 'PURCHASE_LIMIT_EXCEEDED':
      return "You can't buy more of this item.";
    case 'GAME_NOT_FOUND':
      return 'This game has no store yet.';
    case 'RATE_LIMITED':
      return 'Too many requests. Wait a moment.';
    case 'REAL_COINS_DISABLED_IN_EDITOR':
      // Desktop Play refuses published items with it until the website's desktop Play update reaches that environment (core also answers it for a non-owner).
      return "Published items can't be bought with Test Silicon here yet. Test the item as a draft for now.";
    case 'TEST_PRICE_MISSING':
      // Desktop Play, a published item whose Test Silicon price is not there yet: it appears once the item is saved
      // again in Store Manager or the store's backfill has run.
      return "This item can't be bought with Test Silicon yet. Try again in a minute.";
    case 'NOT_GAME_OWNER':
      return "Only this game's owner can test its store in desktop Play.";
    case 'GAME_NOT_LINKED':
      return 'This project is not linked to a game yet. Link it in Store Manager (or ask the assistant), then restart Play.';
    case 'EDITOR_RELAY_REQUIRED':
      return "Purchases work only on the game's Play page.";
    case 'CONSUME_UNCONFIRMED':
      return 'Could not confirm the item was used. Check your inventory before using it again.';
    case 'NOT_OWNED':
      return 'You do not have this item.';
    case 'NOT_CONSUMABLE':
      return 'This item cannot be used up.';
    case 'INSUFFICIENT_QUANTITY': {
      const available = numberOrNull(data?.available);
      return available === null ? 'You do not have that many of this item.' : `You have only ${available} of this item.`;
    }
    default:
      return `Something went wrong (${code}). Try again in a moment.`;
  }
}

export class StoreController {
  public readonly state: StoreState = {
    phase: 'loading',
    isOpen: false,
    activeTab: 'shop',
    gameId: null,
    gameIdSource: 'none',
    gameIdMismatch: false,
    session: null,
    balance: null,
    currency: 'coins',
    items: [],
    inventory: [],
    busyItemId: null,
    pendingItemIds: [],
    unconfirmedItemIds: [],
    awaitingTopUp: false,
    shortfall: null,
    lastError: null,
  };

  private readonly deps: StoreControllerDeps;
  private readonly clock: StoreClock;
  private readonly listeners = new Map<keyof StoreEvents, Set<Handler<unknown>>>();
  private rawItems: GameItem[] = [];
  private destroyed = false;
  /** One purchase at a time: the host shows one confirmation panel. */
  private acquiring = false;
  private balanceRead: Promise<void> | null = null;
  /** The host said the balance changed while a read was running: read once more after it. */
  private readAgain = false;
  /** Counts the host's balance changes; a read that saw a newer one leaves the update to the next read. */
  private hostChanges = 0;
  /** Get Silicon was asked of the host: the next balance change is its answer, for the same player. */
  private topUpRequested = false;
  /** When Get Silicon was last opened, on the store's clock: the balance is re-read for 10 minutes. */
  private topUpSince: number | null = null;
  /** Test Silicon's 15 s passed: the last balance read is out, and "Adding…" stays until it answers. */
  private refillEnding = false;
  /** The timer of the next read while a purchase is processing or Silicon is on its way. */
  private readTimer: unknown = null;
  /** A guest pressed Buy or Claim on this item: it goes on once they sign in (continueAfterSignIn). */
  private wantedAfterSignIn: { itemId: string; at: number } | null = null;
  /** Counts inventory changes from the host's answers, so an older background read does not undo one. */
  private inventoryWrites = 0;
  /**
   * The player may have changed: the host reported another account (reason `account`), the store showed
   * the guest view, a purchase answered ACCOUNT_CHANGED, or, from a host that gives no reason, a change
   * that was not this store's purchase or Get Silicon. The host does not say who is signed in, so the next
   * signed-in inventory read re-bases the purchases being processed instead of settling them against it.
   */
  private rebasePending = false;
  private stopListening: (() => void) | null = null;
  /** The last refresh loaded the signed-in view (inventory and balance). */
  private loadedSignedIn = false;
  /** A load has shown a view; before that, an account change is the start-up, not a sign-in. */
  private viewShown = false;
  /** The catalog was read (desktop Play lists it only to a signed-in owner, so a guest may have none). */
  private catalogLoaded = false;
  /** Counts loads; a load that a newer one replaced applies nothing. */
  private loads = 0;
  /** Counts catalogs taken from a load or a re-read, so an older catalog read applies nothing. */
  private catalogWrites = 0;
  /** Desktop Play's catalog read when the store opens; one at a time. */
  private catalogRead: Promise<void> | null = null;
  /** Purchases being processed, by item id. Nothing forgets one in the session: it settles or stays. */
  private readonly pendingPurchases = new Map<string, PendingPurchase>();

  constructor(deps: StoreControllerDeps) {
    this.deps = deps;
    this.clock = deps.clock ?? PAGE_CLOCK;
  }

  // ---- events -----------------------------------------------------------

  public on<K extends keyof StoreEvents>(event: K, handler: Handler<StoreEvents[K]>): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(handler as Handler<unknown>);
    this.listeners.set(event, set);
    return () => {
      set.delete(handler as Handler<unknown>);
    };
  }

  private emit<K extends keyof StoreEvents>(event: K, payload: StoreEvents[K]): void {
    if (this.destroyed) return;
    // A listener that throws (a UI bug) must never turn a completed purchase
    // into an error or stop the other listeners from running.
    for (const handler of [...(this.listeners.get(event) ?? [])]) {
      try {
        handler(payload);
      } catch (error) {
        console.error(`[Store] listener for "${event}" failed`, error);
      }
    }
  }

  private emitState(): void {
    this.updateReads();
    this.emit('state', { ...this.state, items: [...this.state.items], inventory: [...this.state.inventory] });
  }

  // ---- lifecycle --------------------------------------------------------

  public async init(): Promise<void> {
    const resolved = resolveGameId(this.deps.runtimeGameId, this.deps.configuredGameId);
    const hasHost = this.deps.client.hasHost();
    // Desktop Play (a placeholder runtime id with a host): the host serves the project's linked game and decides
    // "unlinked"; store-config.ts may name another game or none.
    const hostGame = hasHost && resolved.source !== 'runtime';
    this.state.gameId = hostGame ? null : resolved.gameId;
    this.state.gameIdSource = hostGame ? 'host' : resolved.source;
    this.state.gameIdMismatch = hostGame ? false : resolved.mismatch;
    if (!hasHost) {
      this.showUnavailable(new StoreApiError('NO_STORE_HOST', storeErrorMessage('NO_STORE_HOST')));
      this.emitState();
      return;
    }
    this.stopListening?.();
    this.stopListening = this.deps.client.onBalanceChanged(({ reason }) => this.hostBalanceChanged(reason));
    await this.refresh();
  }

  /**
   * Loads items, balance and inventory from the host, showing the loading
   * state: the first load and Retry. Answers that change a card re-read
   * behind the open cards instead (reload).
   */
  public async refresh(): Promise<void> {
    await this.load();
  }

  /** refresh(); false when a newer load replaced this one (it then applies nothing). */
  private async load(): Promise<boolean> {
    if (!this.hasGame() || !this.deps.client.hasHost()) return false;
    const load = ++this.loads;
    this.state.phase = 'loading';
    this.state.lastError = null;
    this.emitState();

    try {
      const [items, balance, held] = await Promise.all([
        this.deps.client.listItems(),
        nullWhenSignedOut(this.deps.client.getBalance()),
        nullWhenSignedOut(this.deps.client.getInventory()),
      ]);
      if (load !== this.loads) return false;
      this.rawItems = items;
      this.catalogLoaded = true;
      this.catalogWrites += 1;
      const signedIn = balance !== null && held !== null;
      this.state.session = { authenticated: signedIn };
      // Set first: the cards show purchases being processed only in the signed-in view.
      this.loadedSignedIn = signedIn;
      if (balance && held) {
        this.applyBalance(balance);
        this.state.inventory = this.inventoryOf(held);
        this.state.items = this.buildViews();
        this.state.phase = items.length ? 'ready' : 'empty';
        this.settleOrRebasePending();
      } else {
        this.showAsGuest();
      }
      this.emitReady();
    } catch (error) {
      if (load !== this.loads) return false;
      this.showLoadFailure(error);
    }
    this.viewShown = true;
    this.emitState();
    return true;
  }

  /**
   * A load that failed. OPEN_TOP_LEVEL is final, with no Retry, and so is GAME_NOT_FOUND in desktop Play (the
   * project's link needs fixing). Desktop Play's GAME_NOT_LINKED and NOT_GAME_OWNER, and its SIGN_IN_REQUIRED on
   * items (a guest: no cards), last until the account changes. Anything else shows the error view with Retry,
   * SIGN_IN_REQUIRED and GAME_NOT_FOUND on the Play page included, as before desktop Play.
   */
  private showLoadFailure(error: unknown): void {
    const host = this.state.gameIdSource === 'host';
    if (error instanceof StoreApiError && (error.code === 'OPEN_TOP_LEVEL' || (error.code === 'GAME_NOT_FOUND' && host))) this.showUnavailable(error);
    else if (isGate(error)) this.showGate(error);
    else if (isSignedOut(error) && host) this.showGuestWithoutCatalog();
    else this.setError(error);
  }

  public destroy(): void {
    this.destroyed = true;
    this.stopReads();
    this.wantedAfterSignIn = null;
    this.stopListening?.();
    this.stopListening = null;
    this.listeners.clear();
  }

  // ---- panel ------------------------------------------------------------

  public open(): void {
    if (this.state.isOpen) return;
    this.state.isOpen = true;
    this.emit('opened', undefined);
    this.emitState();
    // The player may have signed in or out since the last look, or a purchase may have landed.
    void this.refreshBalance();
    // Desktop Play: the creator may have taken an item down to draft, published one or added one in Store Manager.
    if (this.state.gameIdSource === 'host') void this.rereadCatalog();
  }

  public close(): void {
    if (!this.state.isOpen) return;
    this.state.isOpen = false;
    this.state.shortfall = null;
    this.state.awaitingTopUp = false;
    this.wantedAfterSignIn = null;
    this.emit('closed', undefined);
    this.emitState();
  }

  public toggle(): void {
    if (this.state.isOpen) this.close();
    else this.open();
  }

  public setTab(tab: StoreTab): void {
    if (this.state.activeTab === tab) return;
    this.state.activeTab = tab;
    this.emitState();
  }

  // ---- purchases --------------------------------------------------------

  /**
   * Claims a free item or buys a priced one; the host confirms with the
   * player first. Guests are asked to sign in instead, and the item goes on
   * once they do (continueAfterSignIn). A pending answer, or one the store
   * cannot read, shows the purchase as being processed and never sends it
   * again in the session.
   */
  public async acquire(itemId: string): Promise<void> {
    if (!this.canAct() || this.acquiring) return;
    if (!this.loadedSignedIn) {
      // The guest card's button asks to sign in. An item still processing in this session never goes on after it.
      this.wantedAfterSignIn = this.pendingPurchases.has(itemId) ? null : { itemId, at: this.clock.now() };
      this.logIn();
      return;
    }
    if (this.pendingPurchases.has(itemId)) return;
    this.acquiring = true;
    this.state.busyItemId = itemId;
    this.state.lastError = null;
    this.state.shortfall = null;
    this.emitState();
    const quantityBefore = this.quantityOf(itemId);
    let reload = false;
    let getTestSilicon = false;
    try {
      const result = await this.deps.client.acquire(itemId);
      if (result.pending) {
        this.markPending(itemId, quantityBefore, 'pending');
      } else {
        this.setHeld(itemId, result.quantity ?? quantityBefore + 1);
        await this.refreshBalance(); // the charge
        if (this.isFree(itemId)) this.emit('claimed', { itemId });
        else this.emit('purchased', { itemId, orderId: null });
      }
    } catch (error) {
      if (!(error instanceof StoreApiError) || NO_ANSWER_CODES.has(error.code)) {
        // No readable answer: the purchase may have gone through. Never invite a second click.
        this.markPending(itemId, quantityBefore, 'no-answer');
      } else if (error.code === 'INSUFFICIENT_FUNDS' && numberOrNull(error.details?.shortfall) !== null) {
        // The panel shows the shortfall next to Get Silicon.
        const shortfall = numberOrNull(error.details?.shortfall);
        this.state.shortfall = shortfall;
        this.emit('needs-coins', { itemId, shortfall });
      } else if (error.code === 'CANCELLED' && error.details?.reason === 'getSilicon') {
        // The player picked Get Silicon on the host's purchase panel: nothing was sent. The Play page opened its tab
        // already. Desktop Play's panel only says what was picked: the store asks for the Test Silicon itself, as
        // its own button does, so a refused refill shows its line and the button comes back on.
        if (this.state.currency === 'test-coins') getTestSilicon = true;
        else this.awaitTopUp();
        this.state.shortfall = numberOrNull(error.details.shortfall);
      } else {
        reload = this.handleError(error);
        if (error.code === 'SIGN_IN_REQUIRED') this.wantedAfterSignIn = { itemId, at: this.clock.now() };
      }
    } finally {
      this.state.busyItemId = null;
      this.acquiring = false;
    }
    if (reload) await this.reload();
    if (getTestSilicon) await this.getSilicon();
    this.emitState();
  }

  /**
   * Uses up units of a consumable. A refusal that says nothing was used shows
   * its message. Any other failure (UNAVAILABLE, no answer, an unknown code)
   * may hide a use that went through: the store re-reads the inventory, emits
   * `consumed` if the quantity dropped by `quantity`, and otherwise says it
   * could not confirm the use. It never invites a retry: one item could be
   * used twice.
   */
  public async consume(itemId: string, quantity = 1): Promise<void> {
    if (!this.canAct() || !this.loadedSignedIn) return;
    this.state.busyItemId = itemId;
    this.state.lastError = null;
    this.emitState();
    const quantityBefore = this.quantityOf(itemId);
    let reload = false;
    try {
      const { remainingQuantity } = await this.deps.client.consume(itemId, quantity);
      this.setHeld(itemId, remainingQuantity);
      this.emit('consumed', { itemId, remainingQuantity });
    } catch (error) {
      // A use is started by game code, not by the player's press: SIGN_IN_REQUIRED shows the guest view
      // and its line but opens no sign-in (only Buy, Claim and the Sign in button do).
      if (error instanceof StoreApiError && CONSUME_REFUSED.has(error.code)) reload = this.handleError(error, false);
      else await this.confirmConsume(itemId, quantityBefore - quantity);
    } finally {
      this.state.busyItemId = null;
    }
    if (reload) await this.reload();
    this.emitState();
  }

  // ---- silicon ----------------------------------------------------------

  /**
   * Get Silicon: the host opens it (Silicon is never sold inside a game).
   * Call it from the click itself. The balance updates when the host says it
   * changed, when the game tab is visible or focused again, and from a read
   * every 5 s for up to 10 minutes while the game tab is visible. Test
   * Silicon is asked for once until it lands, the panel closes or 15 s
   * pass (getSiliconDisabled), so refills do not stack. It opens no tab, so
   * desktop Play's purchase panel (Get Test Silicon) comes here too, after
   * the panel answers.
   */
  public async getSilicon(): Promise<void> {
    if (!this.canAct() || getSiliconDisabled(this.state)) return;
    this.state.lastError = null;
    this.awaitTopUp();
    this.emitState();
    try {
      await this.deps.client.getSilicon();
    } catch (error) {
      this.state.awaitingTopUp = false;
      this.topUpRequested = false;
      this.handleError(error);
    }
    this.emitState();
  }

  /**
   * Re-reads the balance and the inventory. A sign-in or sign-out since the
   * last load switches the view in place; purchases being processed settle when the
   * inventory shows them. Concurrent calls share one read; a failed read is
   * ignored.
   */
  public refreshBalance(): Promise<void> {
    if (!this.canAct()) return Promise.resolve();
    this.balanceRead ??= this.syncWithHost().finally(() => {
      this.balanceRead = null;
      if (this.readAgain) {
        this.readAgain = false;
        void this.refreshBalance();
      }
    });
    return this.balanceRead;
  }

  /** Same as refreshBalance(): the balance read tells whether the player signed in or out. */
  public checkSession(): Promise<void> {
    return this.refreshBalance();
  }

  // ---- session ----------------------------------------------------------

  /** Asks the host to sign the player in. The store switches to the player's view when the host reports the change. */
  public logIn(): void {
    if (!this.deps.client.hasHost()) return;
    this.deps.client.requestSignIn();
  }

  // ---- gameplay helpers -------------------------------------------------

  /** Whether the player holds the item (its id from the editor's Store Manager). */
  public owns(itemId: string): boolean {
    return this.state.inventory.some((entry) => entry.itemId === itemId && entry.quantity > 0);
  }

  public quantityOf(itemId: string): number {
    return this.state.inventory.find((entry) => entry.itemId === itemId)?.quantity ?? 0;
  }

  // ---- internals --------------------------------------------------------

  /** Actions need a host, a game and a loaded store. */
  private canAct(): boolean {
    const phase = this.state.phase;
    return (
      !this.destroyed &&
      this.hasGame() &&
      this.deps.client.hasHost() &&
      phase !== 'unavailable' &&
      phase !== 'unlinked' &&
      phase !== 'not-owner' &&
      phase !== 'loading'
    );
  }

  /** A game to serve: a known id, or the store host's (desktop Play). */
  private hasGame(): boolean {
    return this.state.gameId !== null || this.state.gameIdSource === 'host';
  }

  /**
   * Desktop Play states another account may not share: a guest without the catalog (items are listed only to a
   * signed-in owner), not the owner, no linked game. An `account` change loads these in full.
   */
  private awaitsFullLoad(): boolean {
    const phase = this.state.phase;
    return (
      (phase === 'guest' && !this.catalogLoaded) ||
      phase === 'not-owner' ||
      (phase === 'unlinked' && this.state.gameIdSource === 'host')
    );
  }

  /**
   * Loads everything again; when that turns a view without a player into a player's, game code hears signed-in.
   * Before the first view (an account change during the first load) nobody signed in.
   */
  private async loadAgain(): Promise<void> {
    const hadPlayer = this.loadedSignedIn || !this.viewShown;
    if (!(await this.load()) || hadPlayer || !this.loadedSignedIn) return;
    this.emit('signed-in', { userId: null, username: null });
    this.continueAfterSignIn();
  }

  /**
   * The host's `balance.changed`, with the reason it gave. On the Play page it
   * follows a purchase (`purchase`, before the purchase answers), the player's
   * return from Get Silicon (`topUp`), and a sign-in, sign-out or switch to
   * another account (`account`). Every one re-reads the balance and the
   * inventory. After `account`, purchases being processed are re-based on the
   * inventory read after it rather than settled against it, and `ready` fires.
   * A host that gives no reason is read as before: a change that is neither
   * this store's purchase nor its Get Silicon may be another account.
   * In desktop Play, `account` loads in full a store that showed no cards to a
   * guest, the not-owner line or the unlinked view, and a load still running
   * (it may have read the previous account).
   */
  private hostBalanceChanged(reason: BalanceChangeReason | undefined): void {
    this.hostChanges += 1;
    if (reason === 'account') {
      this.rebasePending = true;
      this.topUpRequested = false; // the previous player's
    } else if (reason === 'topUp') {
      this.topUpRequested = false;
    } else if (reason === undefined) {
      if (!this.acquiring && !this.topUpRequested) this.rebasePending = true;
      if (!this.acquiring) this.topUpRequested = false;
    }
    if (reason === 'account' && (this.awaitsFullLoad() || this.state.phase === 'loading')) {
      void this.loadAgain();
      return;
    }
    if (this.balanceRead) this.readAgain = true;
    else void this.refreshBalance();
  }

  private async syncWithHost(): Promise<void> {
    const change = this.hostChanges;
    const writes = this.inventoryWrites;
    let balance: Balance | null;
    let held: HeldItem[] | null = null;
    try {
      balance = await this.deps.client.getBalance();
      if (balance) held = await this.deps.client.getInventory();
    } catch (error) {
      // Desktop Play: this account is not the owner, or the project has no linked game. Not transient.
      if (isGate(error)) {
        if (!this.destroyed && change === this.hostChanges) {
          this.showGate(error);
          this.emitState();
        }
        return;
      }
      if (!isSignedOut(error)) return; // transient; the next look tries again
      balance = null;
    }
    if (this.destroyed) return;
    // The host changed again during this read: the read queued after it applies the change.
    if (change !== this.hostChanges) return;
    const signedIn = balance !== null && held !== null;
    // A store whose catalog never loaded (an error view, or desktop Play's guest without cards) loads in full;
    // otherwise the game keeps running and the open panel keeps its cards while the view switches in place.
    if ((signedIn !== this.loadedSignedIn && this.state.phase === 'error') || (signedIn && !this.catalogLoaded)) {
      await this.loadAgain();
      return;
    }
    if (writes !== this.inventoryWrites && balance && held && this.loadedSignedIn) {
      // A purchase or a use answered during this read, so the inventory the store holds is newer: keep it,
      // take only the balance. One more read follows at once; purchases being processed settle (or re-base) on it.
      this.takeBalance(balance);
      this.readAgain = true;
      this.emitState();
      return;
    }
    this.applyRead(balance, held, false);
  }

  /**
   * Re-reads the catalog, the balance and the inventory behind the open cards,
   * after an answer that says a card changed (a price, an owner, an item
   * gone). The phase, the grid and the actions stay as they are until the
   * reads answer; a failed read keeps the old views and the message.
   */
  private async reload(): Promise<void> {
    const change = this.hostChanges;
    const writes = this.inventoryWrites;
    let items: GameItem[];
    let balance: Balance | null;
    let held: HeldItem[] | null;
    try {
      [items, balance, held] = await Promise.all([
        this.deps.client.listItems(),
        nullWhenSignedOut(this.deps.client.getBalance()),
        nullWhenSignedOut(this.deps.client.getInventory()),
      ]);
    } catch {
      return;
    }
    if (this.destroyed) return;
    this.rawItems = items;
    this.catalogLoaded = true;
    this.catalogWrites += 1;
    if (change !== this.hostChanges || writes !== this.inventoryWrites) {
      // The host changed, or answered a purchase or a use, during this read: keep the newer balance and
      // inventory, take only the catalog.
      this.state.inventory = this.inventoryOf(this.state.inventory);
      this.state.items = this.buildViews();
      this.emitState();
      return;
    }
    this.applyRead(balance, held, true);
  }

  /**
   * Desktop Play, when the store opens: re-reads the catalog behind the player's cards, so an item taken down to
   * draft, published or added in Store Manager shows as it is now. Only while the cards show (`ready` or `empty`),
   * one read at a time. The balance read that open() starts alongside finds a sign-out or a gate, so a failed
   * catalog read is ignored, and an answer overtaken by a load, another catalog or a dropped catalog applies nothing.
   */
  private rereadCatalog(): Promise<void> {
    const phase = this.state.phase;
    if (!this.canAct() || !this.catalogLoaded || (phase !== 'ready' && phase !== 'empty')) return Promise.resolve();
    this.catalogRead ??= this.readCatalog().finally(() => {
      this.catalogRead = null;
    });
    return this.catalogRead;
  }

  private async readCatalog(): Promise<void> {
    const load = this.loads;
    const catalog = this.catalogWrites;
    let items: GameItem[];
    try {
      items = await this.deps.client.listItems();
    } catch {
      return;
    }
    const phase = this.state.phase;
    if (this.destroyed || load !== this.loads || catalog !== this.catalogWrites || !this.catalogLoaded) return;
    if (phase !== 'ready' && phase !== 'empty') return;
    this.rawItems = items;
    this.catalogWrites += 1;
    this.state.inventory = this.inventoryOf(this.state.inventory);
    this.state.items = this.buildViews();
    this.state.phase = items.length ? 'ready' : 'empty';
    this.emitState();
  }

  /**
   * Applies a read of the balance and the inventory. A sign-in or sign-out
   * switches the view in place. Otherwise purchases being processed settle
   * (or re-base after another account) and the balance updates. `reloaded`:
   * the catalog was read too, so the cards are rebuilt and `ready` fires as
   * after a load.
   */
  private applyRead(balance: Balance | null, held: HeldItem[] | null, reloaded: boolean): void {
    const signedIn = balance !== null && held !== null;
    if (signedIn !== this.loadedSignedIn) {
      if (balance && held) this.showSignedIn(balance, held);
      else this.showSignedOut();
      this.emitReady();
      if (signedIn) this.emit('signed-in', { userId: null, username: null });
      this.emitState();
      if (signedIn) this.continueAfterSignIn();
      return;
    }
    if (!balance || !held) {
      // Still a guest: only a reload brings anything new (the catalog).
      if (!reloaded) return;
      this.showAsGuest();
      this.emitReady();
      this.emitState();
      return;
    }
    // A change this store did not cause may be another account: the game re-applies what the player owns.
    const otherAccount = this.rebasePending;
    this.state.inventory = this.inventoryOf(held);
    this.settleOrRebasePending();
    this.takeBalance(balance);
    if (reloaded) this.state.phase = this.rawItems.length ? 'ready' : 'empty';
    if (otherAccount || reloaded) this.emitReady();
    this.emitState();
  }

  /** A balance from a read: shown, with `balance-changed`, when it differs. A change ends the wait for Silicon. */
  private takeBalance(balance: Balance): void {
    if (balance.amount === this.state.balance && balance.currency === this.state.currency) return;
    this.applyBalance(balance);
    this.state.shortfall = null;
    this.state.awaitingTopUp = false;
    this.state.items = this.buildViews();
    this.emit('balance-changed', { amount: balance.amount, currency: balance.currency });
  }

  /** The player signed in on the host: balance, inventory and buy buttons, without a loading screen. */
  private showSignedIn(balance: Balance, held: HeldItem[]): void {
    this.loadedSignedIn = true;
    this.state.session = { authenticated: true };
    if (this.state.lastError?.code === 'SIGN_IN_REQUIRED') this.state.lastError = null;
    this.state.shortfall = null;
    this.state.awaitingTopUp = false;
    this.applyBalance(balance);
    this.state.inventory = this.inventoryOf(held);
    this.state.phase = this.rawItems.length ? 'ready' : 'empty';
    this.settleOrRebasePending();
  }

  /** The player signed out on the host: the browsing view, without a loading screen. */
  private showSignedOut(): void {
    this.loadedSignedIn = false;
    this.wantedAfterSignIn = null;
    this.state.session = { authenticated: false };
    this.state.lastError = null;
    this.showAsGuest();
  }

  /** `ready` tells game code to apply what the player owns: after the first load and after every change of player. */
  private emitReady(): void {
    this.emit('ready', { items: this.state.items, inventory: this.state.inventory, balance: this.state.balance });
  }

  /**
   * After a sign-in: the item a guest pressed Buy or Claim on goes on to the
   * host once, so its purchase panel opens (a free item is claimed: the
   * player asked with "Sign in to claim"). Only within 10 minutes, with the
   * store still open, and while the item is still buyable (never one still
   * processing in this session). Nothing was sent for the guest, so this is
   * no retry, and Buy on the panel is still the player's own press.
   */
  private continueAfterSignIn(): void {
    const wanted = this.wantedAfterSignIn;
    this.wantedAfterSignIn = null;
    if (!wanted || !this.state.isOpen || this.clock.now() - wanted.at > CONTINUE_FOR_MS) return;
    if (this.pendingPurchases.has(wanted.itemId)) return;
    const action = this.state.items.find((item) => item.itemId === wanted.itemId)?.action;
    if (action === 'buy' || action === 'buy-again' || action === 'claim') void this.acquire(wanted.itemId);
  }

  /**
   * Get Silicon is open (the store's own button, or the host's purchase
   * panel): the next balance change is its answer, for the same player, and
   * the balance is re-read while a signed-in player waits for it.
   */
  private awaitTopUp(): void {
    this.topUpRequested = true;
    this.refillEnding = false;
    this.state.awaitingTopUp = this.loadedSignedIn;
    this.topUpSince = this.clock.now();
    this.updateReads(true);
  }

  // ---- reads while waiting ------------------------------------------------

  /**
   * Starts, keeps or stops the reads that follow a purchase being processed
   * (every 5 s for 2 minutes after the last one went pending, then every
   * 30 s, up to 10 minutes) and Silicon on its way (every 5 s, up to 10
   * minutes; Test Silicon up to 15 s, then one last read). Reads only,
   * through refreshBalance. The purchase reads pause while the store shows
   * the guest view and resume after the next sign-in. `restart`: a new
   * purchase or Get Silicon starts again at every 5 s.
   */
  private updateReads(restart = false): void {
    if (restart) this.stopReads();
    const delay = this.destroyed ? null : this.nextReadIn();
    if (delay === null) this.stopReads();
    else if (this.readTimer === null) this.readTimer = this.clock.setTimeout(() => this.readTick(), delay);
  }

  private stopReads(): void {
    if (this.readTimer !== null) this.clock.clearTimeout(this.readTimer);
    this.readTimer = null;
  }

  /** Milliseconds to the next read, or null when nothing waits for one. */
  private nextReadIn(): number | null {
    const now = this.clock.now();
    const delays: number[] = [];
    if (this.topUpReadsDue(now)) delays.push(FAST_READS_MS);
    const refillCap = this.refillCapAt();
    if (refillCap !== null) delays.push(Math.max(0, refillCap - now));
    const waiting = [...this.shownPending().values()].filter((pending) => !pending.unconfirmed);
    if (waiting.length > 0) {
      const newest = Math.max(...waiting.map((pending) => pending.since));
      delays.push(now - newest < FAST_READS_FOR_MS ? FAST_READS_MS : SLOW_READS_MS);
      // Each purchase's notice changes right at its 10 minutes.
      for (const pending of waiting) delays.push(Math.max(0, pending.since + READS_FOR_MS - now));
    }
    return delays.length > 0 ? Math.min(...delays) : null;
  }

  private topUpReadsDue(now: number): boolean {
    if (!this.state.awaitingTopUp || this.refillEnding || this.topUpSince === null) return false;
    return now - this.topUpSince < READS_FOR_MS;
  }

  /** When the wait for Test Silicon reaches its 15 s, or null when the store is not waiting for Test Silicon. */
  private refillCapAt(): number | null {
    const { awaitingTopUp, currency } = this.state;
    if (!awaitingTopUp || this.refillEnding || currency !== 'test-coins' || this.topUpSince === null) return null;
    return this.topUpSince + TEST_REFILL_WAIT_MS;
  }

  /**
   * Test Silicon has not shown within 15 s: one last balance read. "Adding…" stays, and the top-up bar stays hidden,
   * until it answers: a changed balance ends the wait there (takeBalance), otherwise it ends when the read settles
   * (or the read the host's change queued behind it). Either way a balance change after that is no longer this
   * store's Get Silicon. A new Get Silicon meanwhile keeps its own wait.
   */
  private endRefillWait(): void {
    const since = this.topUpSince;
    this.refillEnding = true;
    const settled = (): void => {
      if (!this.refillEnding || this.topUpSince !== since) return;
      if (this.balanceRead) {
        void this.balanceRead.finally(settled);
        return;
      }
      this.refillEnding = false;
      this.topUpRequested = false;
      if (!this.state.awaitingTopUp) return;
      this.state.awaitingTopUp = false;
      this.emitState();
    };
    void this.refreshBalance().finally(settled);
  }

  /**
   * One read while waiting, when the game tab is visible. A purchase whose 10
   * minutes passed stays Processing for the session (it may still have
   * charged) and its notice changes; a later read still settles it. Test
   * Silicon that has not shown within 15 s gets one last read
   * (endRefillWait), so a refill that landed without a balance change still
   * shows; "Adding…" goes when it answers.
   */
  private readTick(): void {
    this.readTimer = null;
    if (this.destroyed) return;
    const now = this.clock.now();
    let expired = false;
    for (const pending of this.pendingPurchases.values()) {
      if (pending.unconfirmed || now - pending.since < READS_FOR_MS) continue;
      pending.unconfirmed = true;
      expired = true;
    }
    const refillCap = this.refillCapAt();
    const purchaseReads = [...this.shownPending().values()].some((pending) => !pending.unconfirmed);
    // The cap's read is the one read of this tick; a purchase being processed shares it.
    if (refillCap !== null && now >= refillCap) this.endRefillWait();
    else if ((purchaseReads || this.topUpReadsDue(now)) && pageVisible()) void this.refreshBalance();
    if (expired) {
      this.showPending();
      this.emitState(); // schedules the next read too
    } else {
      this.updateReads();
    }
  }

  /** After a consume whose answer does not say whether it happened: the inventory decides. */
  private async confirmConsume(itemId: string, expectedRemaining: number): Promise<void> {
    let held: HeldItem[] | null = null;
    try {
      held = await this.deps.client.getInventory();
    } catch {
      held = null;
    }
    if (this.destroyed) return;
    if (held) {
      this.inventoryWrites += 1;
      this.state.inventory = this.inventoryOf(held);
      this.state.items = this.buildViews();
      const remainingQuantity = this.quantityOf(itemId);
      if (remainingQuantity === expectedRemaining) {
        this.emit('consumed', { itemId, remainingQuantity });
        return;
      }
    }
    this.setError(new StoreApiError('CONSUME_UNCONFIRMED', storeErrorMessage('CONSUME_UNCONFIRMED')));
  }

  /**
   * Shows a host error. CANCELLED says nothing; SIGN_IN_REQUIRED turns the
   * store into a guest and, when `askSignIn` (the player's own press), asks
   * the host to sign in. Returns whether the store should re-read so the
   * cards show what changed.
   */
  private handleError(error: unknown, askSignIn = true): boolean {
    if (error instanceof StoreApiError && error.code === 'CANCELLED') return false;
    if (isGate(error)) {
      this.showGate(error);
      return false;
    }
    // Another account is signed in now: purchases being processed stay Processing, re-based on the next read.
    if (error instanceof StoreApiError && error.code === 'ACCOUNT_CHANGED') this.rebasePending = true;
    if (error instanceof StoreApiError && error.code === 'SIGN_IN_REQUIRED') {
      this.state.session = { authenticated: false };
      this.showAsGuest();
      this.setError(error);
      if (askSignIn) this.deps.client.requestSignIn();
      return false;
    }
    this.setError(error);
    return error instanceof StoreApiError && RELOAD_AFTER.has(error.code);
  }

  private showUnavailable(error: StoreApiError): void {
    this.state.phase = 'unavailable';
    this.state.balance = null;
    this.state.inventory = [];
    this.state.items = [];
    this.setError(error);
  }

  /**
   * Desktop Play: no linked game (`unlinked`), or not the owner (`not-owner`: its line in the unavailable view).
   * Balance, inventory and cards go; purchases being processed stay for the session and re-base on the next
   * player's read. `ready` fires when a player's items were showing, so the game turns them off. Lasts until the
   * account changes (hostBalanceChanged).
   */
  private showGate(error: StoreApiError): void {
    const hadPlayer = this.loadedSignedIn;
    this.loadedSignedIn = false;
    this.rebasePending = true;
    this.wantedAfterSignIn = null;
    this.topUpRequested = false;
    this.rawItems = [];
    this.catalogLoaded = false;
    this.state.session = null;
    this.state.balance = null;
    this.state.inventory = [];
    this.state.shortfall = null;
    this.state.awaitingTopUp = false;
    this.showPending();
    if (error.code === 'NOT_GAME_OWNER') {
      this.state.phase = 'not-owner';
      this.setError(error);
    } else {
      this.state.phase = 'unlinked';
      this.state.lastError = null;
    }
    if (hadPlayer) this.emitReady();
  }

  /** Desktop Play lists items only to a signed-in creator: the guest view with its Sign in, and no cards. */
  private showGuestWithoutCatalog(): void {
    this.rawItems = [];
    this.catalogLoaded = false;
    this.state.session = { authenticated: false };
    this.showAsGuest();
    this.state.phase = 'guest'; // showAsGuest says 'empty' without a catalog
    this.emitReady();
  }

  /**
   * The browsing view: catalog only, no inventory or balance. Purchases still
   * being processed are kept for the session but not shown (the guest cards
   * keep their Sign in buttons) and their reads pause. Whoever signs in next,
   * the same player or another, the sign-in read re-bases them: they stay
   * Processing and are never bought again in the session. Desktop Play lists
   * items only to a signed-in owner, so its guest view drops the catalog (no
   * cards, no draft at a real Silicon price) and a sign-in loads it in full.
   * It plays only with Test Silicon, so its guest view keeps that wording.
   */
  private showAsGuest(): void {
    this.loadedSignedIn = false;
    this.rebasePending = true;
    const hostGame = this.state.gameIdSource === 'host';
    if (hostGame) {
      this.rawItems = [];
      this.catalogLoaded = false;
    }
    this.state.inventory = [];
    this.state.balance = null;
    this.state.currency = hostGame ? 'test-coins' : 'coins';
    this.state.shortfall = null;
    this.state.awaitingTopUp = false;
    this.showPending();
    this.state.phase = this.rawItems.length || hostGame ? 'guest' : 'empty';
  }

  /** Purchases being processed, as the cards show them: none in the guest view. */
  private shownPending(): ReadonlyMap<string, PendingPurchase> {
    return this.loadedSignedIn ? this.pendingPurchases : NO_PENDING;
  }

  private isFree(itemId: string): boolean {
    const item = this.rawItems.find((entry) => entry.itemId === itemId);
    return item !== undefined && 'free' in item.price;
  }

  /** Records a purchase whose outcome is not in the inventory yet, and starts the reads that look for it. */
  private markPending(itemId: string, quantityBefore: number, reason: 'pending' | 'no-answer'): void {
    this.pendingPurchases.set(itemId, { quantityBefore, since: this.clock.now(), unconfirmed: false });
    this.showPending();
    this.updateReads(true);
    this.emit('purchase-pending', { itemId, reason });
  }

  /** The pending ids, the unconfirmed ones and the cards, from the purchases being processed (none shown to a guest). */
  private showPending(): void {
    const shown = this.shownPending();
    this.state.pendingItemIds = [...shown.keys()];
    this.state.unconfirmedItemIds = [...shown].filter(([, pending]) => pending.unconfirmed).map(([itemId]) => itemId);
    this.state.items = this.buildViews();
  }

  /**
   * After a fresh signed-in inventory read: re-bases the purchases being
   * processed on it when the player may have changed since they started (a
   * sign-out, a sign-in, another account: they stay Processing and are never
   * bought again, but never settle against another player's inventory),
   * otherwise settles them.
   */
  private settleOrRebasePending(): void {
    if (this.rebasePending) {
      this.rebasePending = false;
      for (const [itemId, pending] of this.pendingPurchases) pending.quantityBefore = this.quantityOf(itemId);
      this.showPending();
      return;
    }
    this.settlePending();
  }

  /** Settles every pending purchase whose item the inventory now shows: emits purchased or claimed. */
  private settlePending(): void {
    for (const [itemId, pending] of [...this.pendingPurchases]) {
      if (this.quantityOf(itemId) <= pending.quantityBefore) continue;
      this.pendingPurchases.delete(itemId);
      if (this.isFree(itemId)) this.emit('claimed', { itemId });
      else this.emit('purchased', { itemId, orderId: null });
    }
    this.showPending();
  }

  /** The host said how many the player now holds after a purchase or a use. */
  private setHeld(itemId: string, quantity: number): void {
    this.inventoryWrites += 1;
    const others = this.state.inventory.filter((entry) => entry.itemId !== itemId);
    this.state.inventory = quantity > 0 ? [...others, ...this.inventoryOf([{ itemId, quantity }])] : others;
    this.state.items = this.buildViews();
  }

  /** The host's inventory with each item's catalog details. */
  private inventoryOf(held: HeldItem[]): InventoryItem[] {
    return held.map(({ itemId, quantity }) => {
      const item = this.rawItems.find((entry) => entry.itemId === itemId);
      return {
        itemId,
        name: item?.name ?? itemId,
        description: item?.description ?? '',
        imageUrl: item?.imageUrl ?? null,
        consumable: item?.consumable ?? false,
        quantity,
      };
    });
  }

  private buildViews(): ItemView[] {
    return buildViews(this.rawItems, this.state.inventory, this.state.currency, this.shownPending());
  }

  private applyBalance(balance: Balance): void {
    this.state.balance = balance.amount;
    this.state.currency = balance.currency;
  }

  private setError(error: unknown): void {
    const storeError: StoreError =
      error instanceof StoreApiError
        ? { code: error.code, message: this.messageFor(error) }
        : { code: 'UNKNOWN', message: storeErrorMessage('UNKNOWN') };
    this.state.lastError = storeError;
    if (this.state.phase === 'loading') this.state.phase = 'error';
    this.emit('error', storeError);
  }

  /** storeErrorMessage, except in desktop Play for GAME_NOT_FOUND: the creator fixes the project's link, not the store. */
  private messageFor(error: StoreApiError): string {
    if (error.code === 'GAME_NOT_FOUND' && this.state.gameIdSource === 'host') return LINKED_GAME_NOT_FOUND;
    return storeErrorMessage(error.code, error.details);
  }
}

type ProcessingState = Pick<StoreState, 'pendingItemIds' | 'items'> & Partial<Pick<StoreState, 'unconfirmedItemIds'>>;

/** After 10 minutes of reads without the item: it may still have charged, so the player checks first. */
const UNCONFIRMED_TEXT = "We couldn't confirm this purchase yet. Check your inventory and Silicon balance before buying it again.";

/**
 * The line for purchases still being processed, or null when there are none.
 * A purchase still unconfirmed after 10 minutes gets the line that asks the
 * player to check before buying again.
 */
export function processingText(state: ProcessingState): string | null {
  if (state.pendingItemIds.length === 0) return null;
  const unconfirmed = new Set(state.unconfirmedItemIds ?? []);
  const processing = state.pendingItemIds.filter((id) => !unconfirmed.has(id));
  const lines: string[] = [];
  if (processing.length > 0) {
    const names = processing.map((id) => state.items.find((item) => item.itemId === id)?.name ?? 'your item');
    lines.push(`Purchase processing: ${names.join(', ')}. It appears in your inventory once it goes through; there is no need to buy again.`);
  }
  if (processing.length < state.pendingItemIds.length) lines.push(UNCONFIRMED_TEXT);
  return lines.join(' ');
}

/**
 * The panel's inline notice: an action's error and the purchases still being
 * processed. Both show when both apply, so an error from another action never
 * hides "Purchase processing" (which tells the player not to buy again).
 */
export function storeNotice(
  state: Pick<StoreState, 'phase' | 'lastError'> & ProcessingState,
): { tone: 'error' | 'info'; text: string } | null {
  const catalogShown =
    state.phase !== 'error' && state.phase !== 'loading' && state.phase !== 'unavailable' && state.phase !== 'not-owner';
  const actionError = catalogShown ? state.lastError : null;
  const processing = processingText(state);
  if (actionError) return { tone: 'error', text: processing ? `${actionError.message} ${processing}` : actionError.message };
  return processing ? { tone: 'info', text: processing } : null;
}

/**
 * Whether Get Silicon is off: the store cannot act (no host, no linked game, not the owner, loading), desktop
 * Play's guest view (Test Silicon goes only to the signed-in creator: Sign in comes first), or Test Silicon was
 * asked for and has not landed (at most 15 s), so refills would stack. Real Silicon stays on: the Play page may need
 * to open its tab again.
 */
export function getSiliconDisabled(
  state: Pick<StoreState, 'phase' | 'awaitingTopUp' | 'currency'> & Partial<Pick<StoreState, 'gameIdSource'>>,
): boolean {
  const phase = state.phase;
  if (phase === 'unavailable' || phase === 'unlinked' || phase === 'not-owner' || phase === 'loading') return true;
  if (phase === 'guest' && state.gameIdSource === 'host') return true;
  return state.awaitingTopUp && state.currency === 'test-coins';
}

/**
 * The guest bar's line. Desktop Play lists nothing to a guest, so it asks for the desktop app's creator login;
 * the Play page's line is the one store-panel.html ships.
 */
export function guestText(state: Pick<StoreState, 'gameIdSource'>): string {
  if (state.gameIdSource === 'host') return "Sign in to the desktop app to test this game's store.";
  return 'You are browsing as a guest. Sign in with your Sandbox account to buy or claim items; your Silicon and items follow you across games.';
}

/**
 * How the footer and the start-up log name the game. Desktop Play's host serves the project's linked game and
 * never names it to the game, so neither names store-config.ts's id there.
 */
export function gameText(state: Pick<StoreState, 'gameId' | 'gameIdSource' | 'phase'>): string {
  if (state.gameIdSource === 'host') return state.phase === 'unlinked' ? 'game not linked' : "the project's linked game";
  return state.gameId ? `game ${state.gameId}` : 'game not linked';
}

function buildViews(
  items: GameItem[],
  inventory: InventoryItem[],
  currency: Currency,
  pending: ReadonlyMap<string, unknown>,
): ItemView[] {
  return items.map((item) => {
    const entry = inventory.find((owned) => owned.itemId === item.itemId);
    const quantity = entry?.quantity ?? 0;
    const owned = quantity > 0;
    // Prices are in whatever the host plays with: Test Silicon when it says so, for drafts and published items (Q48).
    const price = 'coins' in item.price ? { coins: item.price.coins, currency } : item.price;
    let action: ItemAction;
    if (owned && !item.consumable) action = 'owned';
    else if ('free' in price) action = 'claim';
    else action = owned ? 'buy-again' : 'buy';
    if (pending.has(item.itemId) && action !== 'owned') action = 'processing';
    return { ...item, price, owned, quantity, action };
  });
}

/** The game tab is visible; without a document (tests) it counts as visible. */
function pageVisible(): boolean {
  return (globalThis as { document?: { visibilityState?: string } }).document?.visibilityState !== 'hidden';
}

/** A signed-out answer, as an error: the store shows the guest view instead. */
function isSignedOut(error: unknown): boolean {
  return error instanceof StoreApiError && error.code === 'SIGN_IN_REQUIRED';
}

/** Desktop Play's GAME_NOT_LINKED or NOT_GAME_OWNER. */
function isGate(error: unknown): error is StoreApiError {
  return error instanceof StoreApiError && GATE_CODES.has(error.code);
}

async function nullWhenSignedOut<T>(read: Promise<T | null>): Promise<T | null> {
  try {
    return await read;
  } catch (error) {
    if (isSignedOut(error)) return null;
    throw error;
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
