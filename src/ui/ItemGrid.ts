/**
 * ItemGrid - a reusable grid of item slots bound to an Inventory. Re-renders on inventory change.
 * Supports drag-and-drop rearrange (when `draggable`), price badges (when `showPrice`), and a
 * slot-click callback. Used by both the backpack and the shop. Safe UI — icons/prices are numbers
 * or developer-authored strings, set via textContent.
 */

import { itemThumbnails } from './ItemThumbnails.js';

import type { Inventory } from '../systems/Inventory.js';

// Each slot element carries a ref so a pointer drop can resolve which inventory/slot it landed on
// (works across grids for player -> merchant / hotbar transfers).
interface SlotRef { inv: Inventory; index: number }
type SlotEl = HTMLElement & { _slotRef?: SlotRef };

export interface ItemGridOptions {
  columns: number;
  draggable?: boolean;
  showPrice?: boolean;
  slotSize?: number;
  /** Stretch slots to fill the container width (square via aspect-ratio) instead of a fixed size. */
  stretch?: boolean;
  /** Show a 1-based number badge in each slot (for the hotbar). */
  showIndex?: boolean;
  /** Called when a slot is clicked (e.g. buy / sell / use). */
  onSlotClick?: (index: number) => void;
  /** Override slot fill / border colour (e.g. to match a themed panel). */
  slotBackground?: string;
  slotBorder?: string;
  /** Element the drag ghost is drawn in (the game UI container); defaults to the grid itself. */
  dragLayer?: HTMLElement;
}

export class ItemGrid {
  private readonly root: HTMLElement;
  private readonly unsub: () => void;
  private readonly slotSize: number;
  private activeIndex = -1;

  constructor(
    private readonly inventory: Inventory,
    private readonly opts: ItemGridOptions,
  ) {
    this.slotSize = opts.slotSize ?? 56;
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      display: 'grid',
      gridTemplateColumns: opts.stretch ? `repeat(${opts.columns}, 1fr)` : `repeat(${opts.columns}, ${this.slotSize}px)`,
      ...(opts.stretch ? { width: '100%' } : { gridAutoRows: `${this.slotSize}px` }),
      gap: '8px',
    } as CSSStyleDeclaration);

    this.unsub = inventory.onChange(() => this.render());
    this.render();
  }

  public get element(): HTMLElement {
    return this.root;
  }

  private render(): void {
    this.root.replaceChildren();
    for (let i = 0; i < this.inventory.size; i++) {
      this.root.appendChild(this.makeSlot(i));
    }
  }

  private makeSlot(index: number): HTMLElement {
    const item = this.inventory.get(index);
    const slot = document.createElement('div');
    Object.assign(slot.style, {
      position: 'relative',
      ...(this.opts.stretch
        ? { width: '100%', aspectRatio: '1 / 1', fontSize: '42px' }
        : { width: `${this.slotSize}px`, height: `${this.slotSize}px`, fontSize: '26px' }),
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#fff',
      // Light slot so dark 3D models (bow/crossbow) stay visible against it (themable per grid).
      background: this.opts.slotBackground ?? 'rgba(206,208,216,0.95)',
      border: `2px solid ${this.opts.slotBorder ?? 'rgba(90,92,104,0.7)'}`,
      borderRadius: '5px',
      boxSizing: 'border-box',
      cursor: 'pointer',
    } as CSSStyleDeclaration);
    // Icon lives in its own element so the async 3D thumbnail can replace it WITHOUT wiping the
    // count/price/index badges (setting slot.textContent='' would remove those too).
    const iconEl = document.createElement('div');
    Object.assign(iconEl.style, {
      display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%',
    } as CSSStyleDeclaration);
    iconEl.textContent = item?.icon ?? '';
    slot.appendChild(iconEl);
    // Real 3D thumbnail when the item has a model; the emoji stays as a fallback until it loads.
    if (item?.iconModelUrl) {
      const url = item.iconModelUrl;
      const img = document.createElement('img');
      Object.assign(img.style, {
        width: '86%', height: '86%', objectFit: 'contain', pointerEvents: 'none',
      } as CSSStyleDeclaration);
      itemThumbnails.get(url, item.iconTextureUrl).then((dataUrl) => {
        if (!dataUrl) return;
        img.src = dataUrl;
        iconEl.textContent = '';
        iconEl.appendChild(img);
      }).catch(() => { /* keep the emoji fallback */ });
    }

    if (this.opts.showPrice && item?.price !== undefined) {
      const price = document.createElement('span');
      price.textContent = String(item.price);
      Object.assign(price.style, {
        position: 'absolute',
        bottom: '1px',
        right: '3px',
        font: '700 10px system-ui, sans-serif',
        color: '#6a4e00',
        textShadow: '0 1px 1px rgba(255,255,255,0.6)',
        lineHeight: '1',
      } as CSSStyleDeclaration);
      slot.appendChild(price);
    }

    // Stack count badge (bottom-right) for consumables carrying more than one unit.
    if (item && (item.count ?? 1) > 1) {
      const cnt = document.createElement('span');
      cnt.textContent = String(item.count);
      Object.assign(cnt.style, {
        position: 'absolute', bottom: '1px', right: '3px',
        font: '700 17px system-ui, sans-serif', color: '#141414', textShadow: '0 1px 1px rgba(255,255,255,0.6)', lineHeight: '1',
      } as CSSStyleDeclaration);
      slot.appendChild(cnt);
    }

    if (this.opts.showIndex) {
      const badge = document.createElement('span');
      badge.textContent = String(index + 1);
      Object.assign(badge.style, {
        position: 'absolute', top: '1px', left: '3px',
        font: '700 11px system-ui, sans-serif', color: 'rgba(20,20,20,0.7)', lineHeight: '1',
      } as CSSStyleDeclaration);
      slot.appendChild(badge);
    }

    // Active-slot highlight (hotbar selection).
    const active = index === this.activeIndex;
    const restColor = active ? '#ffffff' : (this.opts.slotBorder ?? 'rgba(120,120,130,0.6)');
    slot.style.borderColor = restColor;
    if (active) slot.style.transform = 'scale(1.06)';

    slot.addEventListener('mouseenter', () => { slot.style.borderColor = 'rgba(255,215,106,0.9)'; });
    slot.addEventListener('mouseleave', () => { slot.style.borderColor = restColor; });
    if (this.opts.onSlotClick) slot.addEventListener('click', () => this.opts.onSlotClick?.(index));

    if (this.opts.draggable) this.wireDragDrop(slot, index, item !== null);
    return slot;
  }

  private wireDragDrop(slot: HTMLElement, index: number, hasItem: boolean): void {
    // Tag every slot (even empty) as a drop target; only slots with an item start a drag.
    (slot as SlotEl)._slotRef = { inv: this.inventory, index };
    if (!hasItem) return;
    slot.style.cursor = 'grab';

    slot.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const item = this.inventory.get(index);
      if (!item) return;

      // In the editor the game is a panel, so place the ghost inside the game UI layer, relative to it.
      const layer = this.opts.dragLayer ?? this.root;
      const layerRect = layer.getBoundingClientRect();
      const ghost = document.createElement('div');
      Object.assign(ghost.style, {
        position: 'absolute', left: `${e.clientX - layerRect.left}px`, top: `${e.clientY - layerRect.top}px`,
        transform: 'translate(-50%,-50%)', width: '48px', height: '48px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '34px', opacity: '0.9', pointerEvents: 'none', zIndex: '1000',
      } as CSSStyleDeclaration);
      // Use the same baked 3D thumbnail as the slot; fall back to the emoji until/if it loads.
      ghost.textContent = item.icon;
      if (item.iconModelUrl) {
        itemThumbnails.get(item.iconModelUrl, item.iconTextureUrl).then((dataUrl) => {
          if (!dataUrl) return;
          const gimg = document.createElement('img');
          Object.assign(gimg.style, { width: '100%', height: '100%', objectFit: 'contain' } as CSSStyleDeclaration);
          gimg.src = dataUrl;
          ghost.textContent = '';
          ghost.appendChild(gimg);
        }).catch(() => { /* keep emoji */ });
      }
      layer.appendChild(ghost);
      slot.style.opacity = '0.5';

      const move = (ev: PointerEvent) => {
        ghost.style.left = `${ev.clientX - layerRect.left}px`;
        ghost.style.top = `${ev.clientY - layerRect.top}px`;
      };
      const up = (ev: PointerEvent) => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        ghost.remove();
        slot.style.opacity = '1';

        // Find the slot under the cursor (pointer-events on the ghost are off, so it won't intercept).
        let node: HTMLElement | null = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
        let target: SlotRef | undefined;
        while (node) {
          const r = (node as SlotEl)._slotRef;
          if (r) { target = r; break; }
          node = node.parentElement;
        }
        if (!target) return;
        if (target.inv === this.inventory) {
          if (target.index !== index) this.inventory.move(index, target.index);
        } else {
          const item2 = this.inventory.get(index);
          const other = target.inv.get(target.index);
          target.inv.set(target.index, item2);
          this.inventory.set(index, other);
        }
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
  }

  /** Highlight a slot as active (hotbar selection). -1 clears it. */
  public setActive(index: number): void {
    if (this.activeIndex === index) return;
    this.activeIndex = index;
    this.render();
  }

  public dispose(): void {
    this.unsub();
    this.root.remove();
  }
}
