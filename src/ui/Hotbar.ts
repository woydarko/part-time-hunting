/**
 * Hotbar - a bottom-centered quick-slot bar backed by a small Inventory, rendered with ItemGrid so
 * items can be dragged between it and the backpack (and other inventories). Number keys select a
 * slot; selecting a slot equips whatever item sits in it (handled by the pawn).
 * Developer-authored content only (safe UI).
 */

import { ItemGrid } from './ItemGrid.js';

import type { Inventory } from '../systems/Inventory.js';

export class Hotbar {
  private readonly root: HTMLElement;
  private readonly grid: ItemGrid;

  constructor(container: HTMLElement, inventory: Inventory, onSelect: (index: number) => void) {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'absolute',
      left: '50%',
      bottom: '24px',
      transform: 'translateX(-50%)',
      padding: '5px',
      background: 'rgba(0,0,0,0.35)',
      borderRadius: '6px',
      userSelect: 'none',
      pointerEvents: 'auto',
      // Above the backpack/shop overlays (80/85) so the hotbar stays bright and draggable while a
      // menu is open (you can drag items between the hotbar and the backpack).
      zIndex: '90',
    } as CSSStyleDeclaration);

    this.grid = new ItemGrid(inventory, {
      columns: inventory.size,
      draggable: true,
      dragLayer: container,
      showIndex: true,
      slotSize: 48,
      onSlotClick: onSelect,
      // Match the backpack's leather-card palette.
      slotBackground: 'rgba(232,208,170,0.92)',
      slotBorder: 'rgba(120,78,40,0.85)',
    });
    this.root.appendChild(this.grid.element);
    container.appendChild(this.root);
  }

  /** Highlight the active slot (-1 clears). */
  public setActive(index: number): void {
    this.grid.setActive(index);
  }

  public dispose(): void {
    this.grid.dispose();
    this.root.remove();
  }
}
