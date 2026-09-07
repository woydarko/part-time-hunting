/**
 * StatusHUD - a vertical stack in the top-right (just under the gold counter) showing the player's
 * arrow count and any active potion effects with a live countdown. Each row's icon is the item's 3D
 * model (baked thumbnail). Developer-authored UI (safe — numbers + our own model icons).
 */

import { itemThumbnails } from './ItemThumbnails.js';

export interface StatusRow {
  key: string;         // stable id (e.g. 'arrow', 'speed') so we can reuse rows
  modelUrl: string;    // 3D icon model
  textureUrl?: string; // albedo for the thumbnail (if the model needs it)
  text: string;        // right-hand label (count or countdown)
}

export class StatusHUD {
  private readonly root: HTMLElement;
  private readonly rows = new Map<string, { el: HTMLElement; label: HTMLElement }>();

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'absolute', right: '22px', bottom: '22px',
      display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px',
      pointerEvents: 'none', userSelect: 'none', zIndex: '55',
    } as CSSStyleDeclaration);
    container.appendChild(this.root);
  }

  /** Replace the shown rows (order preserved). Rows are reused by key so icons don't reload/flicker. */
  public set(rows: StatusRow[]): void {
    const seen = new Set<string>();
    for (const r of rows) {
      seen.add(r.key);
      let row = this.rows.get(r.key);
      if (!row) {
        const el = document.createElement('div');
        Object.assign(el.style, {
          display: 'flex', alignItems: 'center', gap: '2px', // tight: icon + text only, no background
        } as CSSStyleDeclaration);
        const img = document.createElement('img');
        Object.assign(img.style, {
          width: '56px', height: '56px', objectFit: 'contain',
          filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.7))', // legible over any scene
        } as CSSStyleDeclaration);
        itemThumbnails.get(r.modelUrl, r.textureUrl).then((u) => { if (u) img.src = u; }).catch(() => { /* noop */ });
        const label = document.createElement('span');
        Object.assign(label.style, {
          color: '#fff', font: '700 30px system-ui, sans-serif', textShadow: '0 1px 3px #000', minWidth: '28px', textAlign: 'left',
        } as CSSStyleDeclaration);
        el.append(img, label);
        this.root.appendChild(el);
        row = { el, label };
        this.rows.set(r.key, row);
      }
      row.label.textContent = r.text;
    }
    // Remove rows no longer present.
    for (const [key, row] of this.rows) {
      if (!seen.has(key)) { row.el.remove(); this.rows.delete(key); }
    }
    // Re-order to match `rows`.
    for (const r of rows) {
      const row = this.rows.get(r.key);
      if (row) this.root.appendChild(row.el);
    }
  }

  public dispose(): void {
    this.root.remove();
  }
}
