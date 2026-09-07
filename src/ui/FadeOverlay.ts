/**
 * FadeOverlay - a full-screen black overlay for death/respawn transitions.
 * Fades to black, runs a callback at full black (e.g. teleport the player), then fades back in.
 */

export class FadeOverlay {
  private readonly root: HTMLElement;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'absolute',
      inset: '0',
      background: '#000',
      opacity: '0',
      pointerEvents: 'none',
      transition: 'opacity 0.2s linear',
      zIndex: '100',
    } as CSSStyleDeclaration);
    container.appendChild(this.root);
  }

  /**
   * Fade to black over `outMs`, invoke `atBlack` once fully black, then fade back over `inMs`.
   */
  public flash(atBlack: () => void, outMs = 220, inMs = 320): void {
    this.root.style.transition = `opacity ${outMs}ms linear`;
    // Next frame so the transition applies from opacity 0.
    requestAnimationFrame(() => {
      this.root.style.opacity = '1';
    });
    window.setTimeout(() => {
      try {
        atBlack();
      } finally {
        this.root.style.transition = `opacity ${inMs}ms linear`;
        requestAnimationFrame(() => {
          this.root.style.opacity = '0';
        });
      }
    }, outMs);
  }

  public dispose(): void {
    this.root.remove();
  }
}
