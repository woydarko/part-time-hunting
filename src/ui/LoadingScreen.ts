/**
 * LoadingScreen - a fullscreen overlay shown during the main-menu → gameplay transition while assets
 * preload, so the player never sees the map/character/UI pop in. Singleton: added to the game
 * container (which persists across the scene switch); shown by the menu, hidden by the pawn once the
 * game world has finished preloading. Spinner + "Loading…" (indeterminate).
 */

let overlay: HTMLElement | null = null;

export const LoadingScreen = {
  /** Show the loading overlay on the given container (idempotent). */
  show(container: HTMLElement): void {
    if (overlay) { overlay.style.display = 'flex'; return; }
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: '26px',
      background: '#1c140c', pointerEvents: 'auto', userSelect: 'none', zIndex: '200',
    } as CSSStyleDeclaration);
    el.addEventListener('mousedown', (e) => e.stopPropagation());

    // Spinner (CSS keyframes injected once).
    if (!document.getElementById('pth-loading-kf')) {
      const style = document.createElement('style');
      style.id = 'pth-loading-kf';
      style.textContent = '@keyframes pth-spin{to{transform:rotate(360deg)}}';
      document.head.appendChild(style);
    }
    const spinner = document.createElement('div');
    Object.assign(spinner.style, {
      width: '64px', height: '64px', borderRadius: '50%',
      border: '6px solid rgba(224,194,104,0.25)', borderTopColor: '#e0c268',
      animation: 'pth-spin 0.9s linear infinite',
    } as CSSStyleDeclaration);

    const label = document.createElement('div');
    label.textContent = 'Loading…';
    Object.assign(label.style, {
      color: '#ffe9c2', font: '700 26px system-ui, sans-serif', letterSpacing: '1px',
    } as CSSStyleDeclaration);

    el.append(spinner, label);
    container.appendChild(el);
    overlay = el;
  },

  hide(): void {
    overlay?.remove();
    overlay = null;
  },
};
