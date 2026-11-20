/**
 * ShopUI - the Rogue merchant's "sell loot" panel. Two 3x4 inventory grids stacked on the left:
 *   - YOU: the player's shared inventory (their hunting loot).
 *   - MERCHANT: a staging tray. Drag loot from YOU into here to offer it for sale; the estimated
 *     coin total updates live. Press Sell to complete the trade (loot removed, gold gained).
 * Closing without selling returns the staged loot to the player. Anchored LEFT (NPC framed right).
 */

import * as ENGINE from '@gnsx/genesys.js';

import { ItemGrid } from './ItemGrid.js';
import { Inventory } from '../systems/Inventory.js';

const TRAY_SIZE = 12; // 3x4, matches the player inventory
const CARD_URL = '@project/assets/textures/sellmerchant_card.png';
// Shared leather-card palette (matches backpack + hotbar).
const SLOT_BG = 'rgba(232,208,170,0.92)';
const SLOT_BORDER = 'rgba(120,78,40,0.85)';

export class ShopUI {
  private readonly root: HTMLElement;
  private readonly playerGrid: ItemGrid;
  private readonly trayGrid: ItemGrid;
  private readonly tray: Inventory;
  private readonly totalLabel: HTMLElement;
  private readonly unsubTray: () => void;
  private open = false;

  constructor(
    container: HTMLElement,
    private readonly onClose: () => void,
    private readonly playerInventory: Inventory,
    /** Complete the sale: called with the total coin value of the staged loot. */
    private readonly onSell?: (total: number) => void,
    /** Returns the player's current gold, for the balance/after-sale info. */
    private readonly getGold?: () => number,
  ) {
    this.tray = new Inventory(TRAY_SIZE);

    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'absolute',
      inset: '0',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'flex-start',
      paddingLeft: '48px',
      boxSizing: 'border-box',
      background: 'none',
      pointerEvents: 'auto', // capture ALL clicks so clicking outside the panel can't re-lock the cursor
      zIndex: '80',
    } as CSSStyleDeclaration);
    this.root.addEventListener('mousedown', (e) => e.stopPropagation());

    // The sellmerchant_card art IS the panel (320x640, 1:2). Plain relative box; content lives in an
    // absolutely-inset inner box confined to the card's flat leather interior (inside frame + corners).
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      position: 'relative',
      width: '320px',
      height: '640px',
      boxSizing: 'border-box',
      backgroundSize: '100% 100%',
      backgroundRepeat: 'no-repeat',
      userSelect: 'none',
      pointerEvents: 'auto',
    } as CSSStyleDeclaration);
    ENGINE.resolveAssetPathsInText(CARD_URL).then((url) => { panel.style.backgroundImage = `url('${url}')`; }).catch(() => { /* noop */ });

    const content = document.createElement('div');
    Object.assign(content.style, {
      position: 'absolute', top: '5%', bottom: '5%', left: '7.5%', right: '7.5%',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px',
    } as CSSStyleDeclaration);

    this.playerGrid = new ItemGrid(playerInventory, { columns: 4, draggable: true, dragLayer: container, showPrice: false, slotSize: 56, slotBackground: SLOT_BG, slotBorder: SLOT_BORDER });
    this.trayGrid = new ItemGrid(this.tray, { columns: 4, draggable: true, dragLayer: container, showPrice: false, slotSize: 56, slotBackground: SLOT_BG, slotBorder: SLOT_BORDER });

    this.totalLabel = this.buildInfo();

    content.appendChild(this.buildHeader());
    content.appendChild(this.buildLabel('You'));
    content.appendChild(this.playerGrid.element);
    content.appendChild(this.buildLabel('Merchant — drag loot here to sell'));
    content.appendChild(this.trayGrid.element);
    content.appendChild(this.totalLabel);
    content.appendChild(this.buildSellButton());

    panel.appendChild(content);
    this.root.appendChild(panel);
    container.appendChild(this.root);

    this.unsubTray = this.tray.onChange(() => this.updateTotal());
    this.updateTotal();
  }

  private buildHeader(): HTMLElement {
    const header = document.createElement('div');
    Object.assign(header.style, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '248px' } as CSSStyleDeclaration);
    const title = document.createElement('div');
    title.textContent = 'Sell Loot';
    Object.assign(title.style, { color: '#3a220e', font: '700 22px system-ui, sans-serif' } as CSSStyleDeclaration);
    const closeBtn = document.createElement('div');
    closeBtn.textContent = '✕';
    Object.assign(closeBtn.style, {
      color: '#3a220e', font: '700 24px system-ui, sans-serif', cursor: 'pointer',
      width: '30px', height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center',
    } as CSSStyleDeclaration);
    closeBtn.addEventListener('click', () => this.onClose());
    header.appendChild(title);
    header.appendChild(closeBtn);
    return header;
  }

  private buildLabel(text: string): HTMLElement {
    const label = document.createElement('div');
    label.textContent = text;
    Object.assign(label.style, {
      color: 'rgba(58,34,14,0.78)', font: '700 13px system-ui, sans-serif',
      letterSpacing: '0.04em', textTransform: 'uppercase', width: '248px',
    } as CSSStyleDeclaration);
    return label;
  }

  private buildSellButton(): HTMLElement {
    const btn = document.createElement('div');
    btn.textContent = 'Sell';
    Object.assign(btn.style, {
      textAlign: 'center', padding: '10px 0', font: '700 16px system-ui, sans-serif',
      color: '#12210f', background: '#e0c268', borderRadius: '6px', cursor: 'pointer',
      width: '248px', boxSizing: 'border-box',
    } as CSSStyleDeclaration);
    btn.addEventListener('click', () => this.doSell());
    return btn;
  }

  private trayTotal(): number {
    let total = 0;
    for (let i = 0; i < this.tray.size; i++) total += this.tray.get(i)?.price ?? 0;
    return total;
  }

  private buildInfo(): HTMLElement {
    const info = document.createElement('div');
    Object.assign(info.style, {
      display: 'flex', flexDirection: 'column', gap: '4px', width: '248px',
      borderTop: '1px solid rgba(58,34,14,0.35)', paddingTop: '10px',
    } as CSSStyleDeclaration);
    return info;
  }

  private infoRow(label: string, value: string, color = '#3a220e'): HTMLElement {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'flex', justifyContent: 'space-between',
      font: '700 15px system-ui, sans-serif', color,
    } as CSSStyleDeclaration);
    const l = document.createElement('span'); l.textContent = label;
    const v = document.createElement('span'); v.textContent = value;
    row.append(l, v);
    return row;
  }

  private updateTotal(): void {
    const total = this.trayTotal();
    let count = 0;
    for (let i = 0; i < this.tray.size; i++) if (this.tray.get(i)) count++;
    this.totalLabel.replaceChildren(
      this.infoRow('Selling', `${count} item${count === 1 ? '' : 's'}`),
      this.infoRow('You receive', `💰 ${total}`, '#2f6b12'),
    );
  }

  private doSell(): void {
    const total = this.trayTotal();
    if (total <= 0) return;
    this.onSell?.(total);
    // The staged loot is sold — clear the tray.
    for (let i = 0; i < this.tray.size; i++) this.tray.set(i, null);
  }

  /** Move any un-sold staged loot back to the player so it isn't lost on close. */
  private returnTray(): void {
    for (let i = 0; i < this.tray.size; i++) {
      const item = this.tray.get(i);
      if (item) {
        this.tray.set(i, null);
        this.playerInventory.add(item);
      }
    }
  }

  public show(): void {
    this.open = true;
    this.root.style.display = 'flex';
  }

  public hide(): void {
    this.open = false;
    this.returnTray();
    this.root.style.display = 'none';
  }

  public isOpen(): boolean {
    return this.open;
  }

  public dispose(): void {
    this.unsubTray();
    this.playerGrid.dispose();
    this.trayGrid.dispose();
    this.root.remove();
  }
}
