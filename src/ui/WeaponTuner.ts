/**
 * WeaponTuner - a small dev overlay for dialing in a held weapon's grip transform live in play,
 * since the weapon is attached in code (not a scene node you can select in the inspector). Toggle
 * it, tweak position / rotation (degrees) / scale, and it applies to the equipped weapon instantly;
 * copy the printed line into the weapon's entry in `src/data/weapons.ts`.
 *
 * Developer tool, developer-authored strings only (safe UI).
 */

export interface WeaponTune {
  pos: [number, number, number];
  rot: [number, number, number]; // degrees
  scale: number;
}

export class WeaponTuner {
  private readonly root: HTMLElement;
  private readonly inputs: HTMLInputElement[] = [];
  private readonly out: HTMLElement;
  private readonly label: HTMLElement;
  private open = false;
  private id = '';

  constructor(container: HTMLElement, private readonly onChange: (t: WeaponTune) => void) {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'absolute', left: '12px', top: '80px', display: 'none',
      background: 'rgba(20,20,26,0.92)', border: '1px solid rgba(255,255,255,0.25)',
      borderRadius: '8px', padding: '10px 12px', zIndex: '95', width: '230px',
      font: '600 12px system-ui, sans-serif', color: '#eee', pointerEvents: 'auto',
      userSelect: 'none',
    } as CSSStyleDeclaration);
    this.root.addEventListener('mousedown', (e) => e.stopPropagation());

    this.label = document.createElement('div');
    Object.assign(this.label.style, { marginBottom: '8px', color: '#ffd76a', fontWeight: '700' } as CSSStyleDeclaration);
    this.label.textContent = 'Weapon Tuner';
    this.root.appendChild(this.label);

    const rows: { name: string; step: number }[] = [
      { name: 'pos X', step: 0.01 }, { name: 'pos Y', step: 0.01 }, { name: 'pos Z', step: 0.01 },
      { name: 'rot X', step: 1 }, { name: 'rot Y', step: 1 }, { name: 'rot Z', step: 1 },
      { name: 'scale', step: 0.001 },
    ];
    for (const r of rows) {
      const row = document.createElement('div');
      Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' } as CSSStyleDeclaration);
      const lab = document.createElement('span');
      lab.textContent = r.name;
      Object.assign(lab.style, { width: '48px', color: '#bbb' } as CSSStyleDeclaration);
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.step = String(r.step);
      Object.assign(inp.style, {
        flex: '1', background: '#2a2a33', color: '#fff', border: '1px solid #444',
        borderRadius: '4px', padding: '3px 6px', font: '600 12px system-ui', width: '60px',
      } as CSSStyleDeclaration);
      inp.addEventListener('input', () => this.emit());
      row.append(lab, inp);
      this.root.appendChild(row);
      this.inputs.push(inp);
    }

    this.out = document.createElement('div');
    Object.assign(this.out.style, {
      marginTop: '8px', padding: '6px', background: '#12121a', borderRadius: '4px',
      color: '#9fe', font: '500 10px ui-monospace, monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
    } as CSSStyleDeclaration);
    this.root.appendChild(this.out);

    const hint = document.createElement('div');
    hint.textContent = 'Copy into weapons.ts';
    Object.assign(hint.style, { marginTop: '4px', color: '#888', font: '500 10px system-ui' } as CSSStyleDeclaration);
    this.root.appendChild(hint);

    container.appendChild(this.root);
  }

  /** Seed the fields from the currently equipped weapon's values. */
  public setValues(id: string, t: WeaponTune): void {
    this.id = id;
    this.label.textContent = `Weapon Tuner — ${id}`;
    const v = [t.pos[0], t.pos[1], t.pos[2], t.rot[0], t.rot[1], t.rot[2], t.scale];
    this.inputs.forEach((inp, i) => { inp.value = String(v[i]); });
    this.print(t);
  }

  public toggle(): void {
    this.open = !this.open;
    this.root.style.display = this.open ? 'block' : 'none';
  }

  public isOpen(): boolean {
    return this.open;
  }

  private emit(): void {
    const n = this.inputs.map((inp) => Number(inp.value) || 0);
    const t: WeaponTune = { pos: [n[0], n[1], n[2]], rot: [n[3], n[4], n[5]], scale: n[6] };
    this.onChange(t);
    this.print(t);
  }

  private print(t: WeaponTune): void {
    this.out.textContent =
      `scale: ${t.scale},\n` +
      `offsetPos: [${t.pos.join(', ')}],\n` +
      `offsetRot: [${t.rot.join(', ')}],`;
  }

  public dispose(): void {
    this.root.remove();
  }
}
