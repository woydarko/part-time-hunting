/**
 * GoldHUD - a small coin counter in the top-right corner. Developer-authored (safe UI).
 */

export class GoldHUD {
  private readonly root: HTMLElement;
  private readonly label: HTMLElement;

  constructor(container: HTMLElement, initial = 0) {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'absolute',
      right: '20px',
      top: '20px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '8px 18px',
      background: 'rgba(0,0,0,0.45)',
      border: '2px solid rgba(0,0,0,0.6)',
      borderRadius: '8px',
      font: '700 24px system-ui, sans-serif',
      color: '#ffd76a',
      userSelect: 'none',
      pointerEvents: 'none',
      zIndex: '50',
    } as CSSStyleDeclaration);

    const coin = document.createElement('span');
    coin.textContent = '💰';
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
