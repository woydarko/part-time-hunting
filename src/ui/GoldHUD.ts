/**
 * GoldHUD - a coin counter in the top-right corner: just a gold coin icon + the amount, no card /
 * background. The white coin.png is recoloured to gold via a CSS mask over a gold fill.
 * Developer-authored (safe UI — value is a number).
 */

import * as ENGINE from '@gnsx/genesys.js';

const COIN_URL = '@project/assets/textures/coin.png';
const GOLD = '#ffcf3f';

export class GoldHUD {
  private readonly root: HTMLElement;
  private readonly label: HTMLElement;

  constructor(container: HTMLElement, initial = 0) {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'absolute', right: '22px', top: '18px',
      display: 'flex', alignItems: 'center', gap: '8px',
      font: '800 34px system-ui, sans-serif', color: GOLD,
      textShadow: '0 2px 5px rgba(0,0,0,0.75)',
      userSelect: 'none', pointerEvents: 'none', zIndex: '50',
    } as CSSStyleDeclaration);

    // Coin icon: gold-filled div masked by the (white) coin silhouette → clean gold recolour.
    const coin = document.createElement('div');
    Object.assign(coin.style, {
      width: '40px', height: '40px', background: GOLD, flex: '0 0 auto',
      filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.6))',
    } as CSSStyleDeclaration);
    for (const p of ['mask-size', '-webkit-mask-size']) coin.style.setProperty(p, 'contain');
    for (const p of ['mask-repeat', '-webkit-mask-repeat']) coin.style.setProperty(p, 'no-repeat');
    for (const p of ['mask-position', '-webkit-mask-position']) coin.style.setProperty(p, 'center');
    ENGINE.resolveAssetPathsInText(COIN_URL).then((url) => {
      coin.style.setProperty('-webkit-mask-image', `url('${url}')`);
      coin.style.setProperty('mask-image', `url('${url}')`);
    }).catch(() => { /* noop */ });

    this.label = document.createElement('span');
    this.root.append(coin, this.label);
    container.appendChild(this.root);
    this.set(initial);
  }

  public set(amount: number): void {
    this.label.textContent = String(amount);
  }

  public dispose(): void {
    this.root.remove();
  }
}
