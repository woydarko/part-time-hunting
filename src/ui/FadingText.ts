/**
 * FadingText - a lightweight transient text label that appears, holds, then fades out. Used for the
 * loot-pickup toast ("+1 Rabbit Meat") and the held-item name that flashes above the hotbar
 * (Minecraft-style). No background — just styled text. Developer-authored (safe: item names are our
 * own data strings, set via textContent).
 */

export interface FadingTextOptions {
  /** CSS position anchors + typography applied to the label element. */
  css: Partial<CSSStyleDeclaration>;
  /** How long the text stays fully visible before fading (seconds). */
  holdSeconds?: number;
  /** How long the fade-out takes (seconds). */
  fadeSeconds?: number;
}

export class FadingText {
  private readonly el: HTMLElement;
  private readonly holdMs: number;
  private readonly fadeMs: number;
  private timer: number | null = null;

  constructor(container: HTMLElement, opts: FadingTextOptions) {
    this.holdMs = (opts.holdSeconds ?? 1.3) * 1000;
    this.fadeMs = (opts.fadeSeconds ?? 0.6) * 1000;
    this.el = document.createElement('div');
    Object.assign(this.el.style, {
      position: 'absolute', pointerEvents: 'none', userSelect: 'none', opacity: '0',
      transition: `opacity ${this.fadeMs}ms ease`, textAlign: 'center', whiteSpace: 'nowrap',
      zIndex: '70',
      ...opts.css,
    } as CSSStyleDeclaration);
    container.appendChild(this.el);
  }

  /** Show `text`, cancel any in-flight fade, then hold + fade out. */
  public show(text: string): void {
    this.el.textContent = text;
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    // Snap to visible (disable transition for the instant reset), then re-enable for the fade.
    this.el.style.transition = 'none';
    this.el.style.opacity = '1';
    void this.el.offsetWidth; // force reflow so the next transition takes effect
    this.el.style.transition = `opacity ${this.fadeMs}ms ease`;
    this.timer = window.setTimeout(() => { this.el.style.opacity = '0'; this.timer = null; }, this.holdMs);
  }

  public dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.el.remove();
  }
}
