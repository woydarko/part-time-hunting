/**
 * InteractPrompt - a small centered "Press E …" prompt shown when an interactable is in range.
 * Developer-authored text only (safe UI).
 */

export class InteractPrompt {
  private readonly root: HTMLElement;
  private currentText = '';

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'absolute',
      left: '50%',
      bottom: '120px',
      transform: 'translateX(-50%)',
      padding: '6px 14px',
      background: 'rgba(0,0,0,0.55)',
      color: '#fff',
      font: '600 15px system-ui, sans-serif',
      borderRadius: '6px',
      border: '1px solid rgba(255,255,255,0.25)',
      whiteSpace: 'nowrap',
      userSelect: 'none',
      pointerEvents: 'none',
      zIndex: '60',
      display: 'none',
    } as CSSStyleDeclaration);
    container.appendChild(this.root);
  }

  /** Show the given prompt text, or hide the prompt when the text is empty. */
  public set(text: string): void {
    if (text === this.currentText) return;
    this.currentText = text;
    if (text) {
      this.root.textContent = text;
      this.root.style.display = 'block';
    } else {
      this.root.style.display = 'none';
    }
  }

  public dispose(): void {
    this.root.remove();
  }
}
