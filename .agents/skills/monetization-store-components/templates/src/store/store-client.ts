/**
 * The store's only way to the platform: the page's store host,
 * `window.genesysPlayStore`. Engine-free so it can be unit-tested.
 *
 * On the Play page the game runs in its own frame and the Play page around it
 * answers the host's calls. That page signs the player in, confirms every
 * priced purchase on its own panel, opens Get Silicon, and decides whether the
 * money is real Silicon or Test Silicon. This client sends nothing but item ids
 * and quantities: no tokens, no addresses, no store context. It makes no
 * network request of its own. Where the page has no host (a local folder,
 * `pnpm dev`), the store says "Store unavailable here".
 */

// ---- the host's contract (version 1) ---------------------------------------
// Declared here because a game project cannot import platform code.

export interface PlayStoreBalance {
  signedIn: boolean;
  silicon: number | null;
  /** True when the host plays with Test Silicon. The host decides; the store only shows it. */
  test: boolean;
}

export interface PlayStoreItem {
  itemId: string;
  name: string;
  description: string;
  imageUrl: string | null;
  /** Whole Silicon; 0 for a free item. */
  price: number;
  consumable: boolean;
  /** Desktop Play: true for the owner's draft, false for a published item. The Play page leaves it out. */
  draft?: boolean;
}

export interface PlayStoreItems {
  items: PlayStoreItem[];
}

export interface PlayStoreInventory {
  signedIn: boolean;
  items: { itemId: string; quantity: number }[];
}

/**
 * `pending`: the purchase may still go through (the host got no final answer
 * in time). It is never a failure: buying again could charge twice.
 */
export type PlayStoreAcquireResult =
  | { status: 'acquired'; itemId: string; quantity: number }
  | { status: 'pending'; itemId: string };

export interface PlayStoreConsumeResult {
  itemId: string;
  consumed: number;
  remaining: number;
}

/**
 * Why the host's balance may have changed. `purchase`: the host's own acquire
 * answered. `topUp`: the player came back from a Get Silicon tab the host
 * opened. `account`: the signed-in player changed (sign-in, sign-out, another
 * account). It names no account and no amount. A host may send no reason.
 */
export type BalanceChangeReason = 'purchase' | 'topUp' | 'account';

export interface PlayStoreBalanceChange {
  reason?: BalanceChangeReason;
}

/**
 * `window.genesysPlayStore`. Every rejection carries a `code` and maybe
 * `data`. Codes: SIGN_IN_REQUIRED, OPEN_TOP_LEVEL (the Play page is itself
 * inside a frame), CANCELLED (the player closed the purchase panel; data
 * `{ reason: 'getSilicon', shortfall }` when they picked Get Silicon there), BUSY,
 * PRICE_CHANGED (data `{ price }`), INSUFFICIENT_FUNDS (data `{ balance,
 * price, shortfall, currency }`), ALREADY_OWNED, ITEM_NOT_FOUND,
 * NOT_PURCHASABLE, ITEM_UNAVAILABLE, PURCHASE_LIMIT_EXCEEDED,
 * ACCOUNT_CHANGED, RATE_LIMITED (the host's own request limit),
 * REAL_COINS_DISABLED_IN_EDITOR (desktop Play before the website's update reaches
 * that environment, which buys only drafts with Test Silicon, or a game the creator does not own),
 * TEST_PRICE_MISSING (desktop Play: a published item whose Test Silicon price
 * is not there yet; retry in a minute), EDITOR_RELAY_REQUIRED
 * (purchases only through the Play page), UNAVAILABLE; consume also passes
 * core's own codes through (NOT_OWNED, NOT_CONSUMABLE, INSUFFICIENT_QUANTITY
 * with data `{ available }`, ITEM_NOT_FOUND, GAME_NOT_FOUND). An acquire that
 * might have charged answers `pending`, never an error. New codes may appear.
 *
 * Desktop Play's host also answers every method with GAME_NOT_LINKED (the
 * project has no linked game), NOT_GAME_OWNER (the signed-in creator does not
 * own it) or GAME_NOT_FOUND (core does not know it), and lists items only to
 * a signed-in creator (getItems answers SIGN_IN_REQUIRED otherwise).
 *
 * Guests: balance and inventory answer `{ signedIn: false }`; acquire and
 * consume answer SIGN_IN_REQUIRED (the Play page opens its account panel on
 * a guest's acquire). `onBalanceChanged` fires after a purchase, after Get
 * Silicon, and when the player signs in, signs out or switches account, with
 * `{ reason }` (a host may leave it out).
 */
export interface GenesysPlayStore {
  readonly version: 1;
  getBalance(): Promise<PlayStoreBalance>;
  getItems(): Promise<PlayStoreItems>;
  getInventory(): Promise<PlayStoreInventory>;
  acquire(itemId: string): Promise<PlayStoreAcquireResult>;
  consume(itemId: string, quantity?: number): Promise<PlayStoreConsumeResult>;
  getSilicon(): Promise<void>;
  requestSignIn(): void;
  onBalanceChanged(listener: (change: PlayStoreBalanceChange) => void): () => void;
}

const HOST_METHODS = [
  'getBalance',
  'getItems',
  'getInventory',
  'acquire',
  'consume',
  'getSilicon',
  'requestSignIn',
  'onBalanceChanged',
] as const;

// ---- what the store works with ---------------------------------------------

/**
 * Display currencies: Silicon (coins) and Test Silicon (test-coins). The names
 * predate the rename and stay (Q30). Which one applies is the host's choice.
 */
export type Currency = 'coins' | 'test-coins';

export type Price = { coins: number; currency: Currency } | { free: true };

export interface Balance {
  currency: Currency;
  amount: number;
}

/** Whether the host says a player is signed in. The host does not tell the game who it is. */
export interface SessionInfo {
  authenticated: boolean;
}

export interface GameItem {
  /** The item id. Game code names items by it; the editor's Store Manager shows it. */
  itemId: string;
  name: string;
  description: string;
  price: Price;
  consumable: boolean;
  imageUrl: string | null;
  /** Desktop Play: the owner's draft (the card's Draft chip). Always false on the Play page, which lists no drafts. */
  draft: boolean;
}

export interface InventoryItem {
  itemId: string;
  name: string;
  description: string;
  imageUrl: string | null;
  consumable: boolean;
  quantity: number;
}

/** What the host's inventory says: an item id and how many the player holds. */
export interface HeldItem {
  itemId: string;
  quantity: number;
}

export interface AcquireResult {
  itemId: string;
  /** How many the player now holds; null while pending. */
  quantity: number | null;
  /** The purchase may still go through. Never buy again: wait for the inventory to show it. */
  pending: boolean;
}

export class StoreApiError extends Error {
  public readonly code: string;
  public readonly details: Record<string, unknown> | null;

  constructor(code: string, message: string, details: Record<string, unknown> | null = null) {
    super(message);
    this.name = 'StoreApiError';
    this.code = code;
    this.details = details;
  }
}

export interface StoreClientOptions {
  /**
   * Returns the page's store host. Defaults to `window.genesysPlayStore`,
   * read on every call. Injected for tests.
   */
  host?: () => unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isHost(value: unknown): value is GenesysPlayStore {
  return isRecord(value) && HOST_METHODS.every((method) => typeof value[method] === 'function');
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

const BALANCE_CHANGE_REASONS: ReadonlySet<string> = new Set<BalanceChangeReason>(['purchase', 'topUp', 'account']);

/** The reason a balance change names, or undefined for none or one this store version does not know. */
function balanceChangeReasonOf(change: unknown): BalanceChangeReason | undefined {
  const reason = isRecord(change) ? change.reason : undefined;
  return typeof reason === 'string' && BALANCE_CHANGE_REASONS.has(reason) ? (reason as BalanceChangeReason) : undefined;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The host prices items in whole Silicon, 0 for free. Priced items read as Silicon; the controller marks Test Silicon. */
function gameItemOf(value: unknown): GameItem | null {
  if (!isRecord(value) || typeof value.itemId !== 'string') return null;
  const price = finiteOr(value.price, 0);
  return {
    itemId: value.itemId,
    name: optionalString(value.name) ?? '',
    description: optionalString(value.description) ?? '',
    price: price > 0 ? { coins: price, currency: 'coins' } : { free: true },
    consumable: value.consumable === true,
    imageUrl: optionalString(value.imageUrl),
    draft: value.draft === true,
  };
}

/** A host rejection becomes a StoreApiError with its code and data; anything else is passed on as it is. */
function storeErrorOf(error: unknown): unknown {
  if (!isRecord(error) || typeof error.code !== 'string' || error.code === '') return error;
  return new StoreApiError(error.code, optionalString(error.message) ?? error.code, isRecord(error.data) ? error.data : null);
}

export class StoreClient {
  private readonly readHost: () => unknown;

  constructor(options: StoreClientOptions = {}) {
    this.readHost = options.host ?? (() => (globalThis as { genesysPlayStore?: unknown }).genesysPlayStore);
  }

  /** Whether the page has a store host. Without one the store shows "Store unavailable here". */
  public hasHost(): boolean {
    return this.host() !== null;
  }

  /** The host's contract version, or null without a host. */
  public hostVersion(): number | null {
    const host = this.host();
    return host ? finiteOr((host as { version?: unknown }).version, 0) : null;
  }

  /** What the store sells. Guests may list it. */
  public async listItems(): Promise<GameItem[]> {
    const result = await this.call((host) => host.getItems());
    const items = isRecord(result) && Array.isArray(result.items) ? result.items : [];
    return items.map(gameItemOf).filter((item): item is GameItem => item !== null);
  }

  /** The balance in the host's currency, or null when the player is not signed in. */
  public async getBalance(): Promise<Balance | null> {
    const result = await this.call((host) => host.getBalance());
    if (!isRecord(result) || result.signedIn !== true) return null;
    if (typeof result.silicon !== 'number' || !Number.isFinite(result.silicon)) {
      throw new StoreApiError('UNAVAILABLE', 'The store did not say your balance');
    }
    return { currency: result.test === true ? 'test-coins' : 'coins', amount: result.silicon };
  }

  /** Every item of this game the player holds, or null when the player is not signed in. */
  public async getInventory(): Promise<HeldItem[] | null> {
    const result = await this.call((host) => host.getInventory());
    if (!isRecord(result) || result.signedIn !== true) return null;
    const entries = Array.isArray(result.items) ? result.items : [];
    const held: HeldItem[] = [];
    for (const entry of entries) {
      if (!isRecord(entry) || typeof entry.itemId !== 'string') continue;
      held.push({ itemId: entry.itemId, quantity: finiteOr(entry.quantity, 0) });
    }
    return held;
  }

  /**
   * Claims a free item or buys a priced one. The host confirms the purchase
   * with the player first. An answer that is neither acquired nor an error
   * counts as pending: it may have gone through, so it is never retried.
   */
  public async acquire(itemId: string): Promise<AcquireResult> {
    const result = await this.call((host) => host.acquire(itemId));
    if (isRecord(result) && result.status === 'acquired') {
      return { itemId: optionalString(result.itemId) ?? itemId, quantity: finiteOr(result.quantity, 1), pending: false };
    }
    return { itemId, quantity: null, pending: true };
  }

  /** Spends units of a consumable. */
  public async consume(itemId: string, quantity = 1): Promise<{ remainingQuantity: number }> {
    const result = await this.call((host) => host.consume(itemId, quantity));
    return { remainingQuantity: isRecord(result) ? finiteOr(result.remaining, 0) : 0 };
  }

  /** Get Silicon: the host opens it. Games never sell Silicon themselves. */
  public async getSilicon(): Promise<void> {
    await this.call((host) => host.getSilicon());
  }

  /** Asks the host to sign the player in. The store learns of it from the next balance change. */
  public requestSignIn(): void {
    try {
      this.host()?.requestSignIn();
    } catch {
      // A host that cannot open its sign-in leaves the player a guest.
    }
  }

  /**
   * Calls `listener` when the host says the balance changed (a purchase, a top-up, a sign-in), with the
   * reason it gave: undefined when it gave none or one this store does not know.
   */
  public onBalanceChanged(listener: (change: { reason: BalanceChangeReason | undefined }) => void): () => void {
    const host = this.host();
    if (!host) return () => undefined;
    try {
      const unsubscribe = host.onBalanceChanged((change?: unknown) => listener({ reason: balanceChangeReasonOf(change) }));
      return typeof unsubscribe === 'function' ? unsubscribe : () => undefined;
    } catch {
      return () => undefined;
    }
  }

  private host(): GenesysPlayStore | null {
    const value = this.readHost();
    return isHost(value) ? value : null;
  }

  private async call<T>(run: (host: GenesysPlayStore) => Promise<T>): Promise<T> {
    const host = this.host();
    if (!host) throw new StoreApiError('NO_STORE_HOST', 'Store unavailable here');
    try {
      return await run(host);
    } catch (error) {
      throw storeErrorOf(error);
    }
  }
}
