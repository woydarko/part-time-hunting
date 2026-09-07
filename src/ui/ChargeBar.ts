/**
 * ChargeBar - a thin horizontal charge meter, centered just above the hotbar. Shown while aiming a
 * ranged weapon; the fill (0..1) grows as the shot charges and turns green at full draw. Developer-
 * authored UI (safe). Call set(value) with 0..1 to show, or set(-1) / hide() to hide.
 */

export class ChargeBar {
  private readonly root: HTMLElement;
  private readonly fill: HTMLElement;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'absolute',
      left: '50%',
      bottom: '84px', // sits just above the 48px hotbar (bottom:24 + slot)
      transform: 'translateX(-50%)',
      width: '220px',
      height: '9px',
      background: 'rgba(0,0,0,0.5)',
      border: '1px solid rgba(255,255,255,0.35)',
      borderRadius: '5px',
      overflow: 'hidden',
      display: 'none',
      pointerEvents: 'none',
      zIndex: '88',
    } as CSSStyleDeclaration);

    this.fill = document.createElement('div');
    Object.assign(this.fill.style, {
      height: '100%',
      width: '0%',
      background: '#e0b64a',
      transition: 'width 0.03s linear',
    } as CSSStyleDeclaration);
    this.root.appendChild(this.fill);
    container.appendChild(this.root);
  }

  /** value 0..1 shows the bar at that fill; value < 0 hides it. */
  public set(value: number): void {
    if (value < 0) {
      this.hide();
      return;
    }
    const v = Math.max(0, Math.min(1, value));
    this.root.style.display = 'block';
    this.fill.style.width = `${Math.round(v * 100)}%`;
    this.fill.style.background = v >= 0.999 ? '#7bd36a' : '#e0b64a'; // green at full draw
  }

  public hide(): void {
    this.root.style.display = 'none';
  }

  public dispose(): void {
    this.root.remove();
  }
}
