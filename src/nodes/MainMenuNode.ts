/**
 * MainMenuNode - the title-screen UI. Lives in the `mainmenu` scene (a 3D backdrop copy of the world
 * with no player pawn). Builds a leather-styled HTML overlay with Play + How to Play, and on Play
 * transitions to the actual game scene via the game loop's canonical `openLevel` API.
 *
 * The pawn is suppressed in the menu scene by MyGameMode.playerCanRestart(), so this overlay is the
 * only interactive layer; a startActive ViewTargetCameraNode provides the 3D backdrop view.
 */

import * as ENGINE from '@gnsx/genesys.js';

import { installGameFont } from '../ui/gameFont.js';

const GAME_SCENE_URL = '@project/assets/default.genesys-scene';

const LEATHER_DARK = '#3a220e';
const PANEL_BG = 'rgba(232,208,170,0.96)';
const PANEL_BORDER = 'rgba(120,78,40,0.9)';
const BTN_BG = '#e0c268';
const BTN_TEXT = '#12210f';

@ENGINE.GameClass()
export class MainMenuNode extends ENGINE.SceneNode {
  private root: HTMLElement | null = null;
  private transitioning = false;

  public override beginPlay(): boolean {
    if (!super.beginPlay()) return false;
    const gc = this.getWorld()?.gameContainer;
    if (gc) {
      void installGameFont(gc);
      this.build(gc);
    }
    return true;
  }

  public override endPlay(): boolean {
    this.root?.remove();
    this.root = null;
    return super.endPlay();
  }

  private build(container: HTMLElement): void {
    const root = document.createElement('div');
    Object.assign(root.style, {
      position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column',
      alignItems: 'flex-start', justifyContent: 'center', gap: '4px',
      paddingLeft: 'clamp(48px, 8vw, 130px)', boxSizing: 'border-box',
      pointerEvents: 'auto', userSelect: 'none', zIndex: '100',
      background: 'none', // no dark overlay — let the 3D backdrop show through
    } as CSSStyleDeclaration);
    root.addEventListener('mousedown', (e) => e.stopPropagation());
    root.classList.add('trimen-font');

    // Title.
    const title = document.createElement('div');
    title.textContent = 'Part Time Hunting';
    Object.assign(title.style, {
      color: '#ffe9c2', font: '700 72px system-ui, sans-serif',
      textShadow: '0 4px 0 rgba(0,0,0,0.45), 0 0 18px rgba(0,0,0,0.4)', letterSpacing: '1px',
    } as CSSStyleDeclaration);
    const subtitle = document.createElement('div');
    subtitle.textContent = 'Hunt • Loot • Trade';
    Object.assign(subtitle.style, {
      color: '#ffdd9e', font: '700 22px system-ui, sans-serif', marginBottom: '34px',
      textShadow: '0 2px 4px rgba(0,0,0,0.6)',
    } as CSSStyleDeclaration);

    const playBtn = this.makeButton('Play', () => this.startGame());
    const howBtn = this.makeButton('How to Play', () => this.toggleHowTo());
    Object.assign(howBtn.style, { background: PANEL_BG, color: LEATHER_DARK } as CSSStyleDeclaration);

    root.append(title, subtitle, playBtn, howBtn, this.buildHowTo());
    container.appendChild(root);
    this.root = root;
  }

  private makeButton(label: string, onClick: () => void): HTMLElement {
    const btn = document.createElement('div');
    btn.textContent = label;
    Object.assign(btn.style, {
      width: '260px', textAlign: 'center', padding: '14px 0', margin: '5px 0',
      font: '700 24px system-ui, sans-serif', color: BTN_TEXT, background: BTN_BG,
      border: `3px solid ${PANEL_BORDER}`, borderRadius: '10px', cursor: 'pointer',
      boxShadow: '0 4px 0 rgba(0,0,0,0.35)',
    } as CSSStyleDeclaration);
    btn.addEventListener('mouseenter', () => { btn.style.transform = 'translateY(-2px)'; });
    btn.addEventListener('mouseleave', () => { btn.style.transform = 'translateY(0)'; });
    btn.addEventListener('click', onClick);
    return btn;
  }

  private howToPanel: HTMLElement | null = null;

  private buildHowTo(): HTMLElement {
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      marginTop: '22px', width: 'min(80vw, 460px)', padding: '20px 24px',
      background: PANEL_BG, border: `3px solid ${PANEL_BORDER}`, borderRadius: '12px',
      color: LEATHER_DARK, font: '600 17px system-ui, sans-serif', lineHeight: '1.8',
      boxShadow: '0 8px 24px rgba(0,0,0,0.45)', display: 'none',
    } as CSSStyleDeclaration);
    const rows: [string, string][] = [
      ['WASD', 'Move'],
      ['Mouse', 'Look around'],
      ['Space', 'Jump'],
      ['Left Click', 'Attack / hold to charge bow'],
      ['1 – 4', 'Select weapon / potion'],
      ['B', 'Open backpack'],
      ['F', 'Pick up loot'],
      ['Walk up to a merchant', 'Buy gear / sell loot'],
    ];
    for (const [key, desc] of rows) {
      const row = document.createElement('div');
      Object.assign(row.style, { display: 'flex', justifyContent: 'space-between', gap: '16px' } as CSSStyleDeclaration);
      const k = document.createElement('span'); k.textContent = key;
      Object.assign(k.style, { fontWeight: '800', color: '#5a3410' } as CSSStyleDeclaration);
      const d = document.createElement('span'); d.textContent = desc;
      Object.assign(d.style, { textAlign: 'right' } as CSSStyleDeclaration);
      row.append(k, d);
      panel.appendChild(row);
    }
    this.howToPanel = panel;
    return panel;
  }

  private toggleHowTo(): void {
    if (!this.howToPanel) return;
    this.howToPanel.style.display = this.howToPanel.style.display === 'none' ? 'block' : 'none';
  }

  private startGame(): void {
    if (this.transitioning) return;
    this.transitioning = true;
    this.root?.remove();
    this.root = null;
    const gameLoop = this.getWorld()?.gameLoop;
    if (!gameLoop) return;
    void gameLoop.openLevel(GAME_SCENE_URL);
  }
}
