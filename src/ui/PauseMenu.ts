/**
 * PauseMenu - the in-game pause overlay (default scene). Resume / Settings / Menu. Settings holds
 * three sliders: third-person look sensitivity, aim sensitivity, and master volume — persisted via
 * GameSettings and applied live (sensitivity is read by the pawn each frame; volume through onVolume).
 * Developer-authored UI (safe — labels + numeric sliders only).
 */

import * as ENGINE from '@gnsx/genesys.js';

import { getSettings, updateSetting, SETTINGS_RANGES, type Settings } from '../systems/GameSettings.js';
import { Sfx } from '../systems/Sfx.js';

const PANEL_BG = 'rgba(232,208,170,0.97)';
const PANEL_BORDER = 'rgba(120,78,40,0.9)';
const LEATHER_DARK = '#3a220e';
const BTN_CARD_URL = '@project/assets/materials/button_card.png';

export class PauseMenu {
  private readonly root: HTMLElement;
  private readonly mainCol: HTMLElement;
  private readonly settingsCol: HTMLElement;
  private open = false;

  constructor(
    container: HTMLElement,
    private readonly onResume: () => void,
    private readonly onMenu: () => void,
    /** Apply master volume (0..1) live. */
    private readonly onVolume: (v: number) => void,
  ) {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'absolute', inset: '0', display: 'none', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.55)', pointerEvents: 'auto', userSelect: 'none', zIndex: '150',
    } as CSSStyleDeclaration);
    this.root.addEventListener('mousedown', (e) => e.stopPropagation());

    this.mainCol = this.buildMain();
    this.settingsCol = this.buildSettings();
    this.settingsCol.style.display = 'none';
    this.root.append(this.mainCol, this.settingsCol);
    container.appendChild(this.root);
  }

  private buildMain(): HTMLElement {
    const col = document.createElement('div');
    Object.assign(col.style, { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' } as CSSStyleDeclaration);
    const title = document.createElement('div');
    title.textContent = 'Paused';
    Object.assign(title.style, { color: '#ffe9c2', font: '700 44px system-ui, sans-serif', textShadow: '0 3px 6px rgba(0,0,0,0.6)', marginBottom: '10px' } as CSSStyleDeclaration);
    col.append(
      title,
      this.button('Resume', () => this.onResume()),
      this.button('Settings', () => this.showSettings()),
      this.button('Menu', () => this.onMenu()),
    );
    return col;
  }

  private buildSettings(): HTMLElement {
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      display: 'flex', flexDirection: 'column', gap: '18px', width: 'min(86vw, 440px)',
      background: PANEL_BG, border: `3px solid ${PANEL_BORDER}`, borderRadius: '14px', padding: '26px 28px',
      boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
    } as CSSStyleDeclaration);
    const title = document.createElement('div');
    title.textContent = 'Settings';
    Object.assign(title.style, { color: LEATHER_DARK, font: '700 30px system-ui, sans-serif', textAlign: 'center' } as CSSStyleDeclaration);
    panel.appendChild(title);

    const s = getSettings();
    panel.appendChild(this.slider('Sensitivity', 'tpSensitivity', s));
    panel.appendChild(this.slider('Aim Sensitivity', 'aimSensitivity', s));
    panel.appendChild(this.slider('Volume', 'volume', s));

    const back = this.button('Back', () => this.showMain());
    back.style.marginTop = '6px';
    panel.appendChild(back);
    return panel;
  }

  private slider(label: string, key: keyof Settings, s: Settings): HTMLElement {
    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', flexDirection: 'column', gap: '6px' } as CSSStyleDeclaration);
    const head = document.createElement('div');
    Object.assign(head.style, { display: 'flex', justifyContent: 'space-between', color: LEATHER_DARK, font: '700 16px system-ui, sans-serif' } as CSSStyleDeclaration);
    const name = document.createElement('span'); name.textContent = label;
    const val = document.createElement('span');
    const range = SETTINGS_RANGES[key];
    const pct = (v: number): string => `${Math.round(((v - range.min) / (range.max - range.min)) * 100)}%`;
    val.textContent = pct(s[key]);
    head.append(name, val);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(range.min); input.max = String(range.max); input.step = String(range.step);
    input.value = String(s[key]);
    Object.assign(input.style, { width: '100%', accentColor: '#b4622a', cursor: 'pointer' } as CSSStyleDeclaration);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      updateSetting(key, v);
      val.textContent = pct(v);
      if (key === 'volume') this.onVolume(v);
    });
    row.append(head, input);
    return row;
  }

  private button(label: string, onClick: () => void): HTMLElement {
    // Same button_card design + size as the main menu (280x95).
    const btn = document.createElement('div');
    btn.textContent = label;
    Object.assign(btn.style, {
      width: '280px', height: '95px', boxSizing: 'border-box', margin: '2px 0',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      font: '700 30px system-ui, sans-serif', color: LEATHER_DARK, cursor: 'pointer',
      backgroundSize: '100% 100%', backgroundRepeat: 'no-repeat', transition: 'filter 0.1s',
    } as CSSStyleDeclaration);
    ENGINE.resolveAssetPathsInText(BTN_CARD_URL).then((url) => { btn.style.backgroundImage = `url('${url}')`; }).catch(() => { /* noop */ });
    btn.addEventListener('mouseenter', () => { btn.style.filter = 'brightness(1.12)'; });
    btn.addEventListener('mouseleave', () => { btn.style.filter = 'none'; });
    btn.addEventListener('click', () => { Sfx.play('uiClick', 0.8); onClick(); });
    return btn;
  }

  private showSettings(): void { this.mainCol.style.display = 'none'; this.settingsCol.style.display = 'flex'; }
  private showMain(): void { this.settingsCol.style.display = 'none'; this.mainCol.style.display = 'flex'; }

  public show(): void { this.open = true; this.showMain(); this.root.style.display = 'flex'; }
  public hide(): void { this.open = false; this.root.style.display = 'none'; }
  public isOpen(): boolean { return this.open; }
  public dispose(): void { this.root.remove(); }
}
