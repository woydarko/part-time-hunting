/**
 * HealthBar - a simple HUD health bar (red fill on a dark track) in the bottom-left corner.
 * Developer-authored content only (safe UI — no dynamic/untrusted strings; values are numbers).
 */

export class HealthBar {
  private readonly root: HTMLElement;
  private readonly fill: HTMLElement;
  private current = 1; // fraction 0..1

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'absolute',
      left: '24px',
      bottom: '24px',
      width: '320px',
      height: '30px',
      padding: '4px',
      background: 'rgba(0,0,0,0.45)',
      border: '2px solid rgba(0,0,0,0.6)',
      borderRadius: '5px',
      boxSizing: 'border-box',
      userSelect: 'none',
      pointerEvents: 'none',
      zIndex: '50',
    } as CSSStyleDeclaration);

    const track = document.createElement('div');
    Object.assign(track.style, {
      position: 'relative',
      width: '100%',
      height: '100%',
      background: 'rgba(40,10,10,0.8)',
      borderRadius: '3px',
      overflow: 'hidden',
    } as CSSStyleDeclaration);

    this.fill = document.createElement('div');
    Object.assign(this.fill.style, {
      width: '100%',
      height: '100%',
      background: 'linear-gradient(#ff5a5a, #c72d2d)',
      transition: 'width 0.15s ease-out',
    } as CSSStyleDeclaration);

    track.appendChild(this.fill);
    this.root.appendChild(track);
    container.appendChild(this.root);
  }

  /** Update the bar from current/max health. */
  public setHealth(current: number, max: number): void {
    const frac = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
    this.current = frac;
    this.fill.style.width = `${frac * 100}%`;
  }

  public dispose(): void {
    this.root.remove();
  }
}
