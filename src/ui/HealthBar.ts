/**
 * HealthBar - bottom-left HUD: a player portrait above a health bar, with a coloured HP number to the
 * side. The bar fill + number shift colour with health (>=80% green, 20-79% yellow, <20% red).
 * Developer-authored content only (safe UI — values are numbers, portrait is our own asset).
 */

import * as ENGINE from '@gnsx/genesys.js';

const PORTRAIT_URL = '@project/assets/textures/chara_hp.png';

function hpColor(frac: number): string {
  if (frac >= 0.8) return '#5be05b'; // green
  if (frac >= 0.2) return '#ffd24a'; // yellow
  return '#ff5a5a';                  // red
}

export class HealthBar {
  private readonly root: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly num: HTMLElement;
  private readonly staminaFill: HTMLElement;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'absolute', left: '24px', bottom: '24px',
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '6px',
      userSelect: 'none', pointerEvents: 'none', zIndex: '50',
    } as CSSStyleDeclaration);

    // Player portrait (above the bar).
    const portrait = document.createElement('img');
    Object.assign(portrait.style, {
      height: '72px', width: 'auto', objectFit: 'contain',
      filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.6))',
    } as CSSStyleDeclaration);
    ENGINE.resolveAssetPathsInText(PORTRAIT_URL).then((url) => { portrait.src = url; }).catch(() => { /* noop */ });

    // Row: bar + number.
    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '12px' } as CSSStyleDeclaration);

    const bar = document.createElement('div');
    Object.assign(bar.style, {
      width: '320px', height: '30px', padding: '4px', boxSizing: 'border-box',
      background: 'rgba(0,0,0,0.45)', border: '2px solid rgba(0,0,0,0.6)', borderRadius: '5px',
    } as CSSStyleDeclaration);
    const track = document.createElement('div');
    Object.assign(track.style, {
      position: 'relative', width: '100%', height: '100%',
      background: 'rgba(40,10,10,0.8)', borderRadius: '3px', overflow: 'hidden',
    } as CSSStyleDeclaration);
    this.fill = document.createElement('div');
    Object.assign(this.fill.style, {
      width: '100%', height: '100%', background: hpColor(1), transition: 'width 0.15s ease-out, background 0.15s',
    } as CSSStyleDeclaration);
    track.appendChild(this.fill);
    bar.appendChild(track);

    this.num = document.createElement('div');
    Object.assign(this.num.style, {
      font: '800 30px system-ui, sans-serif', color: hpColor(1), textShadow: '0 2px 4px rgba(0,0,0,0.75)', minWidth: '48px',
    } as CSSStyleDeclaration);
    this.num.textContent = '100';

    row.append(bar, this.num);

    // Stamina bar — thinner, directly below the HP bar (same width, left-aligned).
    const staminaBar = document.createElement('div');
    Object.assign(staminaBar.style, {
      width: '320px', height: '16px', padding: '3px', boxSizing: 'border-box',
      background: 'rgba(0,0,0,0.45)', border: '2px solid rgba(0,0,0,0.6)', borderRadius: '4px',
    } as CSSStyleDeclaration);
    const staminaTrack = document.createElement('div');
    Object.assign(staminaTrack.style, {
      position: 'relative', width: '100%', height: '100%',
      background: 'rgba(10,25,40,0.8)', borderRadius: '2px', overflow: 'hidden',
    } as CSSStyleDeclaration);
    this.staminaFill = document.createElement('div');
    Object.assign(this.staminaFill.style, {
      width: '100%', height: '100%', background: '#46c6ff', transition: 'width 0.08s linear',
    } as CSSStyleDeclaration);
    staminaTrack.appendChild(this.staminaFill);
    staminaBar.appendChild(staminaTrack);

    this.root.append(portrait, row, staminaBar);
    container.appendChild(this.root);
  }

  /** Update the bar + number from current/max health. */
  public setHealth(current: number, max: number): void {
    const frac = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
    const color = hpColor(frac);
    this.fill.style.width = `${frac * 100}%`;
    this.fill.style.background = color;
    this.num.textContent = String(Math.max(0, Math.round(current)));
    this.num.style.color = color;
  }

  /** Update the stamina bar from current/max stamina. Dims when empty. */
  public setStamina(current: number, max: number): void {
    const frac = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
    this.staminaFill.style.width = `${frac * 100}%`;
    this.staminaFill.style.background = frac <= 0.001 ? '#2a6a8a' : '#46c6ff';
  }

  public dispose(): void {
    this.root.remove();
  }
}
