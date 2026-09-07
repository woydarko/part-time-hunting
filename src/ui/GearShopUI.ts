/**
 * GearShopUI - the Ranger's gear shop. Same open/close/camera/freeze flow as the shop, but the
 * content is 3 category tabs (Melee / Range / Boots); picking a tab shows that category's items in
 * a simple ◀ ▶ carousel (one item card at a time). Placeholder items for now; buying is a stub.
 * Anchored to the LEFT (the 3D Ranger is framed on the right). Safe UI — developer-authored strings.
 */

import * as ENGINE from '@gnsx/genesys.js';

import { WEAPONS, POTION_PRICES, ARROW_ITEM } from '../data/weapons.js';
import { POTIONS, type PotionEffect } from '../data/potions.js';
import { Potion3DPreview } from './Potion3DPreview.js';

const CARD_URL = '@project/assets/textures/gearshop_card.png';
// Shared leather-card palette (matches backpack / hotbar / sell merchant).
const LEATHER_DARK = '#3a220e';
const TAB_BG = 'rgba(210,180,135,0.85)';
const TAB_BORDER = 'rgba(120,78,40,0.7)';
const TAB_ACTIVE_BG = 'rgba(150,96,44,0.95)';
const TAB_ACTIVE_BORDER = '#3a220e';
const BUY_BG = '#e0c268'; // same as the Sell button in the merchant
const BUY_TEXT = '#12210f';
const DISABLED_BG = 'rgba(120,90,55,0.45)';

export interface GearItem {
  icon: string;
  name: string;
  price: number;
  /** Weapon registry id — set for buyable weapons so the pawn can grant + equip them. */
  equipId?: string;
  /** Potion effect key — 'heal' | 'speed' | 'damage'. Consumable: applies on buy, never "owned". */
  potion?: string;
  /** Ammo key ('arrow'). Consumable, bought one at a time, stacks in the backpack. */
  ammo?: 'arrow';
  /** Model + texture for the card's 3D preview (weapons/potions derive theirs; ammo sets it here). */
  previewModelUrl?: string;
  previewTextureUrl?: string;
}

/** Result of a buy attempt, drives the card feedback. */
export type BuyResult = 'ok' | 'owned' | 'poor';

/** Build a buyable weapon card from the registry so price/damage never drift from WEAPONS. */
function weaponItem(id: string): GearItem {
  const w = WEAPONS[id];
  return { icon: w.icon, name: w.name, price: w.price, equipId: w.id };
}

const CATEGORIES: { label: string; items: GearItem[] }[] = [
  {
    label: 'Melee',
    items: [weaponItem('dagger'), weaponItem('blade'), weaponItem('axe')],
  },
  {
    label: 'Range',
    items: [
      weaponItem('bow'),
      weaponItem('crossbow'),
      {
        icon: ARROW_ITEM.icon, name: `${ARROW_ITEM.name} (x1)`, price: ARROW_ITEM.price, ammo: 'arrow',
        previewModelUrl: ARROW_ITEM.modelUrl, previewTextureUrl: ARROW_ITEM.textureUrl,
      },
    ],
  },
  {
    label: 'Potion',
    items: [
      { icon: '🟢', name: 'Health Potion (+30 HP)', price: POTION_PRICES.heal, potion: 'heal' },
      { icon: '🔵', name: 'Speed Potion (+40%)', price: POTION_PRICES.speed, potion: 'speed' },
      { icon: '🔴', name: 'Damage Potion (2x)', price: POTION_PRICES.damage, potion: 'damage' },
    ],
  },
];

export class GearShopUI {
  private readonly root: HTMLElement;
  private readonly tabEls: HTMLElement[] = [];
  private readonly cardIcon: HTMLElement;
  private readonly potionPreview = new Potion3DPreview(150);
  private readonly cardName: HTMLElement;
  private readonly cardPrice: HTMLElement;
  private readonly buyBtn: HTMLElement;
  private readonly feedback: HTMLElement;
  private open = false;
  private catIndex = 0;
  private itemIndex = 0;

  constructor(
    container: HTMLElement,
    private readonly onClose: () => void,
    private readonly onBuy?: (category: string, item: GearItem) => BuyResult,
    private readonly isOwned?: (item: GearItem) => boolean,
    private readonly getGold?: () => number,
  ) {
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
      pointerEvents: 'auto', // capture ALL clicks: clicking outside the panel must not re-lock the cursor
      zIndex: '80',
    } as CSSStyleDeclaration);
    // Swallow mousedown so the controller's click-to-pointer-lock never fires while the shop is open.
    this.root.addEventListener('mousedown', (e) => e.stopPropagation());

    // The gearshop_card art IS the panel (520x520). Plain relative box; content lives in an
    // absolutely-inset inner box confined to the card's flat leather interior (inside frame + corners).
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      position: 'relative',
      width: '520px',
      height: '520px',
      aspectRatio: '1 / 1',
      boxSizing: 'border-box',
      backgroundSize: '100% 100%',
      backgroundRepeat: 'no-repeat',
      userSelect: 'none',
      pointerEvents: 'auto',
    } as CSSStyleDeclaration);
    ENGINE.resolveAssetPathsInText(CARD_URL).then((url) => { panel.style.backgroundImage = `url('${url}')`; }).catch(() => { /* noop */ });

    const content = document.createElement('div');
    Object.assign(content.style, {
      position: 'absolute', top: '12%', bottom: '8%', left: '8%', right: '8%',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px',
    } as CSSStyleDeclaration);

    // Header.
    const header = document.createElement('div');
    Object.assign(header.style, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginTop: '-17px', marginBottom: '-10px' } as CSSStyleDeclaration);
    const title = document.createElement('div');
    title.textContent = 'Gear Shop';
    Object.assign(title.style, { color: LEATHER_DARK, font: '700 35px system-ui, sans-serif', paddingLeft: '12px' } as CSSStyleDeclaration);
    // Close ✕ sits in the card's top-right corner (absolute on the panel), not aligned with the title.
    const closeBtn = document.createElement('div');
    closeBtn.textContent = '✕';
    Object.assign(closeBtn.style, {
      position: 'absolute', top: '50px', right: '50px', zIndex: '2',
      color: LEATHER_DARK, font: '700 26px system-ui, sans-serif', cursor: 'pointer',
      width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
    } as CSSStyleDeclaration);
    closeBtn.addEventListener('click', () => this.onClose());
    header.appendChild(title);

    // Category tabs.
    const tabs = document.createElement('div');
    Object.assign(tabs.style, { display: 'flex', gap: '6px', width: '100%' } as CSSStyleDeclaration);
    CATEGORIES.forEach((cat, i) => {
      const tab = document.createElement('div');
      tab.textContent = cat.label;
      Object.assign(tab.style, {
        flex: '1',
        textAlign: 'center',
        padding: '12px 0',
        font: '700 18px system-ui, sans-serif',
        color: LEATHER_DARK,
        background: TAB_BG,
        border: `2px solid ${TAB_BORDER}`,
        borderRadius: '6px',
        cursor: 'pointer',
      } as CSSStyleDeclaration);
      tab.addEventListener('click', () => this.setCategory(i));
      tabs.appendChild(tab);
      this.tabEls.push(tab);
    });

    // Carousel: ◀  [ card ]  ▶
    const carousel = document.createElement('div');
    // Arrows hug the (now card-less) item content instead of stretching to the frame edges.
    Object.assign(carousel.style, { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '14px', width: '100%' } as CSSStyleDeclaration);
    // Bare arrow glyphs — no card/outline, just a clickable chevron.
    const arrowStyle = {
      width: '58px', flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center',
      font: '700 50px system-ui, sans-serif', color: LEATHER_DARK, cursor: 'pointer',
      background: 'none', border: 'none', userSelect: 'none',
    } as CSSStyleDeclaration;
    const left = document.createElement('div'); left.textContent = '◀'; Object.assign(left.style, arrowStyle);
    left.addEventListener('click', () => this.step(-1));
    const right = document.createElement('div'); right.textContent = '▶'; Object.assign(right.style, arrowStyle);
    right.addEventListener('click', () => this.step(1));

    const card = document.createElement('div');
    Object.assign(card.style, {
      flex: '0 0 auto', width: '300px', height: '290px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px',
      padding: '0', boxSizing: 'border-box', background: 'none', border: 'none',
    } as CSSStyleDeclaration);
    // Fixed-height media box so the emoji (72px) and the 3D preview (130px) occupy the SAME vertical
    // space — switching items in a category never shifts the name/price/button rows below it.
    const mediaBox = document.createElement('div');
    Object.assign(mediaBox.style, {
      width: '100%', height: '150px', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto',
    } as CSSStyleDeclaration);
    this.cardIcon = document.createElement('div');
    Object.assign(this.cardIcon.style, { fontSize: '84px', lineHeight: '1' } as CSSStyleDeclaration);
    this.cardName = document.createElement('div');
    Object.assign(this.cardName.style, {
      color: LEATHER_DARK, font: '700 23px system-ui, sans-serif', textAlign: 'center', lineHeight: '1.1',
      width: '100%', height: '42px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
    } as CSSStyleDeclaration);
    this.cardPrice = document.createElement('div');
    Object.assign(this.cardPrice.style, { color: '#8a5a12', font: '700 18px system-ui, sans-serif', height: '22px' } as CSSStyleDeclaration);
    this.buyBtn = document.createElement('div');
    Object.assign(this.buyBtn.style, {
      marginTop: '4px', padding: '9px 34px', font: '700 17px system-ui, sans-serif', color: BUY_TEXT,
      background: BUY_BG, borderRadius: '6px', cursor: 'pointer', flex: '0 0 auto',
    } as CSSStyleDeclaration);
    this.buyBtn.addEventListener('click', () => this.tryBuy());
    this.feedback = document.createElement('div');
    Object.assign(this.feedback.style, {
      height: '14px', font: '700 13px system-ui, sans-serif', color: '#8a5a12',
    } as CSSStyleDeclaration);
    this.potionPreview.element.style.display = 'none'; // shown only for potion items
    mediaBox.append(this.cardIcon, this.potionPreview.element);
    card.append(mediaBox, this.cardName, this.cardPrice, this.buyBtn, this.feedback);

    carousel.append(left, card, right);
    content.append(header, tabs, carousel);
    panel.appendChild(content);
    panel.appendChild(closeBtn);
    this.root.appendChild(panel);
    container.appendChild(this.root);

    this.setCategory(0);
  }

  private setCategory(i: number): void {
    this.catIndex = i;
    this.itemIndex = 0;
    this.tabEls.forEach((tab, k) => {
      const active = k === i;
      tab.style.background = active ? TAB_ACTIVE_BG : TAB_BG;
      tab.style.borderColor = active ? TAB_ACTIVE_BORDER : TAB_BORDER;
      tab.style.color = active ? '#fff' : LEATHER_DARK;
    });
    this.render();
  }

  private step(dir: number): void {
    const n = CATEGORIES[this.catIndex].items.length;
    this.itemIndex = (this.itemIndex + dir + n) % n;
    this.render();
  }

  private render(): void {
    const cat = CATEGORIES[this.catIndex];
    const item = cat.items[this.itemIndex];
    this.cardIcon.textContent = item.icon;
    // Live spinning 3D model for both potions and weapons; emoji only if there's no model.
    const potionDef = item.potion ? POTIONS[item.potion as PotionEffect] : undefined;
    const weaponDef = item.equipId ? WEAPONS[item.equipId] : undefined;
    const modelUrl = potionDef?.modelUrl ?? weaponDef?.iconUrl ?? item.previewModelUrl;
    if (modelUrl) {
      this.cardIcon.style.display = 'none';
      this.potionPreview.element.style.display = 'block';
      this.potionPreview.show(modelUrl, weaponDef?.iconTextureUrl ?? item.previewTextureUrl); // potions embed their colour
    } else {
      this.cardIcon.style.display = 'block';
      this.potionPreview.element.style.display = 'none';
      this.potionPreview.hide();
    }
    this.cardName.textContent = item.name;
    this.cardPrice.textContent = item.price > 0 ? `${item.price}` : 'Free';
    this.feedback.textContent = '';

    // Buy vs Owned button state.
    const owned = !!item.equipId && !!this.isOwned?.(item);
    const buyable = !!item.equipId || !!item.potion || !!item.ammo;
    if (owned) {
      this.buyBtn.textContent = 'Owned';
      this.buyBtn.style.background = DISABLED_BG;
      this.buyBtn.style.color = 'rgba(255,255,255,0.85)';
      this.buyBtn.style.cursor = 'default';
    } else {
      this.buyBtn.textContent = 'Buy';
      this.buyBtn.style.background = buyable ? BUY_BG : DISABLED_BG;
      this.buyBtn.style.color = buyable ? BUY_TEXT : 'rgba(255,255,255,0.85)';
      this.buyBtn.style.cursor = buyable ? 'pointer' : 'default';
    }
  }

  private tryBuy(): void {
    const cat = CATEGORIES[this.catIndex];
    const item = cat.items[this.itemIndex];
    if ((!item.equipId && !item.potion && !item.ammo) || !this.onBuy) return;
    const result = this.onBuy(cat.label, item);
    this.render(); // refresh gold + Owned state first (render clears feedback)
    if (result === 'ok') this.setFeedback('Purchased!', '#bfe08a');
    else if (result === 'owned') this.setFeedback('Already owned', 'rgba(255,255,255,0.7)');
    else this.setFeedback('Not enough gold', '#ff8f6a');
  }

  private setFeedback(text: string, color: string): void {
    this.feedback.textContent = text;
    this.feedback.style.color = color;
  }

  public show(): void {
    this.open = true;
    this.root.style.display = 'flex';
    this.render(); // (re)start the potion preview spin if a potion card is showing
  }

  public hide(): void {
    this.open = false;
    this.root.style.display = 'none';
    this.potionPreview.hide(); // stop the spin loop while closed
  }

  public isOpen(): boolean {
    return this.open;
  }

  public dispose(): void {
    this.potionPreview.dispose();
    this.root.remove();
  }
}
