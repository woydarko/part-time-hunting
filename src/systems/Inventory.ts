/**
 * Inventory - a simple slotted item container shared between UIs (backpack + shop).
 * Emits a change event whenever slots mutate so any bound ItemGrid re-renders.
 */

export interface InventoryItem {
  /** Emoji / short icon (developer-authored — safe UI). */
  icon: string;
  /** Optional display name. */
  name?: string;
  /** Optional price (shown by shop grids). */
  price?: number;
  /** Optional stack count. */
  count?: number;
  /** If set, selecting this item in the hotbar equips that gear (e.g. "dagger"). */
  equipId?: string;
  /** If set, this item is a consumable potion (effect key: 'heal' | 'speed' | 'damage'). Stacks by count. */
  potion?: string;
  /** Stack identity — items sharing a stackId merge (up to MAX_STACK) before taking a new slot. */
  stackId?: string;
  /** If set, the slot renders this 3D model as its icon (a baked thumbnail) instead of the emoji. */
  iconModelUrl?: string;
  /** Albedo texture applied to the thumbnail model (KayKit weapons need it or they render gray). */
  iconTextureUrl?: string;
}

/** Max units per stack; anything beyond spills into a new slot. */
export const MAX_STACK = 8;

export class Inventory {
  private readonly slots: (InventoryItem | null)[];
  private readonly listeners = new Set<() => void>();

  constructor(size: number) {
    this.slots = new Array(size).fill(null);
  }

  public get size(): number {
    return this.slots.length;
  }

  public get(index: number): InventoryItem | null {
    return this.slots[index] ?? null;
  }

  public set(index: number, item: InventoryItem | null): void {
    if (index < 0 || index >= this.slots.length) return;
    this.slots[index] = item;
    this.emit();
  }

  /** Swap two slots (used by drag-and-drop rearrange). */
  public move(from: number, to: number): void {
    if (from === to) return;
    if (from < 0 || from >= this.slots.length || to < 0 || to >= this.slots.length) return;
    const tmp = this.slots[to];
    this.slots[to] = this.slots[from];
    this.slots[from] = tmp;
    this.emit();
  }

  /** Put an item in the first empty slot. Returns the slot index, or -1 when full. */
  public add(item: InventoryItem): number {
    const index = this.slots.findIndex((s) => s === null);
    if (index === -1) return -1;
    this.slots[index] = item;
    this.emit();
    return index;
  }

  /**
   * Add a stackable item: fills existing stacks of the same `stackId` (or potion) up to MAX_STACK,
   * then spills the remainder into new slots (also capped at MAX_STACK each). Returns the first slot
   * used, or -1 if nothing could be placed (inventory full). Non-stackable items take one slot.
   */
  public addStack(item: InventoryItem): number {
    const key = item.stackId ?? item.potion;
    if (!key) return this.add(item);
    let remaining = item.count ?? 1;
    let firstSlot = -1;
    let changed = false;
    // 1) top up existing stacks of this key.
    for (let i = 0; i < this.slots.length && remaining > 0; i++) {
      const s = this.slots[i];
      if (!s || (s.stackId ?? s.potion) !== key) continue;
      const room = MAX_STACK - (s.count ?? 1);
      if (room <= 0) continue;
      const add = Math.min(room, remaining);
      s.count = (s.count ?? 1) + add;
      remaining -= add;
      changed = true;
      if (firstSlot === -1) firstSlot = i;
    }
    // 2) spill into empty slots, MAX_STACK at a time.
    while (remaining > 0) {
      const empty = this.slots.findIndex((s) => s === null);
      if (empty === -1) break; // full
      const add = Math.min(MAX_STACK, remaining);
      this.slots[empty] = { ...item, count: add };
      remaining -= add;
      changed = true;
      if (firstSlot === -1) firstSlot = empty;
    }
    if (changed) this.emit();
    return firstSlot;
  }

  /** How many more units of a stack key (stackId or potion) fit: stack top-ups plus empty slots. */
  public roomFor(key: string): number {
    let room = 0;
    for (const s of this.slots) {
      if (!s) room += MAX_STACK;
      else if ((s.stackId ?? s.potion) === key) room += Math.max(0, MAX_STACK - (s.count ?? 1));
    }
    return room;
  }

  /** Total count of items matching a stackId across all slots (e.g. arrows on hand). */
  public countOf(stackId: string): number {
    let total = 0;
    for (const s of this.slots) if (s && (s.stackId ?? s.potion) === stackId) total += s.count ?? 1;
    return total;
  }

  /** Remove one unit of the given stackId from any slot holding it. Returns true if one was removed. */
  public consumeStack(stackId: string): boolean {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s && (s.stackId ?? s.potion) === stackId) return this.consumeOne(i);
    }
    return false;
  }

  /** Remove one unit from a stack; clears the slot when it hits zero. Returns true if consumed. */
  public consumeOne(index: number): boolean {
    const item = this.slots[index];
    if (!item) return false;
    const next = (item.count ?? 1) - 1;
    if (next <= 0) this.slots[index] = null;
    else item.count = next;
    this.emit();
    return true;
  }

  /** Snapshot of all slots (deep-copied) for persistence. */
  /** Add empty slots up to `size` (never shrinks). Bound grids re-render with the new slots. */
  public grow(size: number): void {
    if (size <= this.slots.length) return;
    while (this.slots.length < size) this.slots.push(null);
    this.emit();
  }

  public serialize(): (InventoryItem | null)[] {
    return this.slots.map((s) => (s ? { ...s } : null));
  }

  /** Replace all slots from a saved snapshot (deep-copied), then emit one change. */
  public load(items: (InventoryItem | null)[]): void {
    for (let i = 0; i < this.slots.length; i++) {
      const src = i < items.length ? items[i] : null;
      this.slots[i] = src ? { ...src } : null;
    }
    this.emit();
  }

  /** Subscribe to change events. Returns an unsubscribe function. */
  public onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void {
    for (const cb of this.listeners) cb();
  }
}
