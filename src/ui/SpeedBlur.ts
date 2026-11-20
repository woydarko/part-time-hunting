/**
 * SpeedBlur - a full-screen overlay that blurs only the screen EDGES (radial mask keeps the centre
 * sharp), faded in while sprinting to sell the speed boost alongside the FOV kick. Pure CSS
 * backdrop-filter; no per-frame work — toggled on/off and CSS eases the opacity.
 */

export class SpeedBlur {
  private readonly el: HTMLElement;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    const mask = 'radial-gradient(ellipse 60% 60% at 50% 50%, transparent 50%, black 90%)';
    Object.assign(this.el.style, {
      position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '40',
      backdropFilter: 'blur(6px)', maskImage: mask,
      opacity: '0', transition: 'opacity 0.2s ease-out',
    } as CSSStyleDeclaration);
    this.el.style.setProperty('-webkit-backdrop-filter', 'blur(6px)');
    this.el.style.setProperty('-webkit-mask-image', mask);
    container.appendChild(this.el);
  }

  /** Fade the edge blur in (sprinting) or out. */
  public setActive(on: boolean): void {
    this.el.style.opacity = on ? '1' : '0';
  }

  public dispose(): void {
    this.el.remove();
  }
}
