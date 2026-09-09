/**
 * BackpackUI - the player's 7x7 backpack, toggled with B. Renders the shared Inventory via an
 * ItemGrid with drag-and-drop rearrange. Centered overlay (no camera move).
 */

import * as ENGINE from '@gnsx/genesys.js';

import { ItemGrid } from './ItemGrid.js';

import type { Inventory } from '../systems/Inventory.js';

const CARD_URL = '@project/assets/textures/backpack_card.png';

export class BackpackUI {
  private readonly root: HTMLElement;
  private readonly grid: ItemGrid;
  private open = false;

  constructor(container: HTMLElement, inventory: Inventory, private readonly onClose: () => void) {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'absolute',
      inset: '0',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0,0,0,0.5)',
      pointerEvents: 'auto',
      zIndex: '85',
    } as CSSStyleDeclaration);
    // Swallow mousedown so the controller's click-to-pointer-lock never fires while the backpack is
    // open (otherwise clicking/dragging re-locks the cursor and you can't interact).
    this.root.addEventListener('mousedown', (e) => e.stopPropagation());

    // The backpack_card art IS the panel (square 1:1). It's a plain relative box; the header + grid
    // live in an absolutely-positioned inner box inset to the card's flat interior so they can never
    // drift or overflow the decorative frame.
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      position: 'relative',
      width: 'min(64vh, 440px)',
      height: 'min(64vh, 440px)',
      aspectRatio: '1 / 1',
      backgroundSize: '100% 100%',
      backgroundRepeat: 'no-repeat',
      boxSizing: 'border-box',
      userSelect: 'none',
    } as CSSStyleDeclaration);
    // Resolve the @project texture path to a served URL, then set it as the card background.
    ENGINE.resolveAssetPathsInText(CARD_URL).then((url) => { panel.style.backgroundImage = `url('${url}')`; }).catch(() => { /* noop */ });

    // Inner content box — pinned to the flat leather interior (inside the frame border + corners).
    const content = document.createElement('div');
    Object.assign(content.style, {
      position: 'absolute', top: '10%', left: '12%', right: '12%', bottom: '8%',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px',
    } as CSSStyleDeclaration);

    // Header.
    const header = document.createElement('div');
    Object.assign(header.style, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '312px' } as CSSStyleDeclaration);
    const title = document.createElement('div');
    title.textContent = 'Backpack';
    Object.assign(title.style, { color: '#3a220e', font: '700 35px system-ui, sans-serif', textShadow: '0 1px 0 rgba(255,255,255,0.25)' } as CSSStyleDeclaration);
    const closeBtn = document.createElement('div');
    closeBtn.textContent = '✕';
    Object.assign(closeBtn.style, {
      position: 'absolute', top: '8.5%', right: '8.5%', zIndex: '2',
      width: '35px', height: '35px', display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#3a220e', font: '700 30px system-ui, sans-serif', cursor: 'pointer',
    } as CSSStyleDeclaration);
    closeBtn.addEventListener('click', () => this.onClose());
    header.appendChild(title);

    // Grid slots tinted to the leather-card palette; fixed slotSize so the 4-col grid fills the
    // card's inner flat area (stretch/1fr collapses under the panel's alignItems:center).
    this.grid = new ItemGrid(inventory, {
      // Backpack shows the stack COUNT only (price is a shop concept) — avoids the price/count badges
      // overlapping in the same corner and being misread as quantity.
      columns: 4, draggable: true, showPrice: false, slotSize: 72,
      slotBackground: 'rgba(232,208,170,0.92)', slotBorder: 'rgba(120,78,40,0.85)',
    });

    content.appendChild(header);
    content.appendChild(this.grid.element);
    panel.appendChild(content);
    panel.appendChild(closeBtn);
    this.root.appendChild(panel);
    container.appendChild(this.root);
  }

  public show(): void {
    this.open = true;
    this.root.style.display = 'flex';
  }

  public hide(): void {
    this.open = false;
    this.root.style.display = 'none';
  }

  public isOpen(): boolean {
    return this.open;
  }

  public dispose(): void {
    this.grid.dispose();
    this.root.remove();
  }
}
