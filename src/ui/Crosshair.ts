/**
 * Crosshair - a small centered aiming reticle shown only while aiming a ranged weapon.
 * Developer-authored markup only (safe UI).
 */

export class Crosshair {
  private readonly root: HTMLElement;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: '22px',
      height: '22px',
      transform: 'translate(-50%,-50%)',
      pointerEvents: 'none',
      display: 'none',
      zIndex: '70',
    } as CSSStyleDeclaration);

    // Center dot.
    const dot = document.createElement('div');
    Object.assign(dot.style, {
      position: 'absolute', left: '50%', top: '50%', width: '4px', height: '4px',
      transform: 'translate(-50%,-50%)', borderRadius: '50%',
      background: '#fff', boxShadow: '0 0 2px #000',
    } as CSSStyleDeclaration);
    this.root.appendChild(dot);

    // Four ticks around the dot.
    const tick = (x: string, y: string, w: string, h: string) => {
      const t = document.createElement('div');
      Object.assign(t.style, {
        position: 'absolute', left: x, top: y, width: w, height: h,
        transform: 'translate(-50%,-50%)', background: 'rgba(255,255,255,0.9)',
        boxShadow: '0 0 2px #000',
      } as CSSStyleDeclaration);
      this.root.appendChild(t);
    };
    tick('50%', '0%', '2px', '7px');
    tick('50%', '100%', '2px', '7px');
    tick('0%', '50%', '7px', '2px');
    tick('100%', '50%', '7px', '2px');

    container.appendChild(this.root);
  }

  public setShown(on: boolean): void {
    this.root.style.display = on ? 'block' : 'none';
  }

  public dispose(): void {
    this.root.remove();
  }
}
