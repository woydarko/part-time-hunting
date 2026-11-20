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
import { LoadingScreen } from '../ui/LoadingScreen.js';
import { Sfx } from '../systems/Sfx.js';
import { GAME_SCENE_URL } from '../data/scenes.js';

const LOGO_URL = '@project/assets/materials/logo_pth.png';
const BTN_CARD_URL = '@project/assets/materials/button_card.png';
const STUDIO_LOGO_URL = '@project/assets/textures/tengok_logo_black.png';
const STUDIO_LINK = 'https://x.com/tengokstudio';

const LEATHER_DARK = '#3a220e';
const PANEL_BG = 'rgba(232,208,170,0.96)';
const PANEL_BORDER = 'rgba(120,78,40,0.9)';

@ENGINE.GameClass()
export class MainMenuNode extends ENGINE.SceneNode {
  private root: HTMLElement | null = null;
  private transitioning = false;
  private musicHandle: { id: string; audioUrl: string; isPositional: boolean } | null = null;

  public override beginPlay(): boolean {
    if (!super.beginPlay()) return false;
    const gc = this.getWorld()?.gameContainer;
    if (gc) {
      void installGameFont(gc);
      this.build(gc);
    }
    // Looping menu theme (Music bus).
    void Sfx.playLoop('menuMusic', 'Music', 0.5).then((h) => { this.musicHandle = h; });
    // If we came from gameplay (Menu button), a cover was shown to hide the raw backdrop during the
    // scene swap — drop it now that the menu + camera are up (wait a couple frames so both render).
    requestAnimationFrame(() => requestAnimationFrame(() => LoadingScreen.hide()));
    return true;
  }

  public override endPlay(): boolean {
    this.root?.remove();
    this.root = null;
    Sfx.stop(this.musicHandle);
    this.musicHandle = null;
    return super.endPlay();
  }

  private build(container: HTMLElement): void {
    const root = document.createElement('div');
    Object.assign(root.style, {
      position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column',
      // Top-anchored so opening How-to-Play (buttons swap for the panel) never re-centers / shifts
      // the logo — it stays put.
      alignItems: 'flex-start', justifyContent: 'flex-start', gap: '4px',
      paddingLeft: 'clamp(48px, 8vw, 130px)', paddingTop: 'clamp(40px, 9vh, 120px)', boxSizing: 'border-box',
      pointerEvents: 'auto', userSelect: 'none', zIndex: '100',
      background: 'none', // no dark overlay — let the 3D backdrop show through
    } as CSSStyleDeclaration);
    root.addEventListener('mousedown', (e) => e.stopPropagation());
    root.classList.add('trimen-font');

    // Logo image (replaces the text title). @project path resolved to a served URL.
    const logo = document.createElement('img');
    Object.assign(logo.style, {
      height: 'clamp(240px, 42vh, 460px)', width: 'auto', maxWidth: '90vw', objectFit: 'contain',
      marginBottom: '20px', marginLeft: '-12px', filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.5))',
    } as CSSStyleDeclaration);
    ENGINE.resolveAssetPathsInText(LOGO_URL).then((url) => { logo.src = url; }).catch(() => { /* noop */ });
    this.logoEl = logo;

    this.playBtn = this.makeButton('Play', () => this.startGame());
    // Co-op: matchmaking pairs two hunters on a shared server (published game, signed-in players).
    this.coopBtn = this.makeButton('Hunt Together', () => this.toggleCoopSearch());
    this.howBtn = this.makeButton('How to Play', () => this.showHowTo());
    // Matchmaking status / error line under the buttons (text only: messages can come from the API).
    const coopStatus = document.createElement('div');
    Object.assign(coopStatus.style, {
      font: '700 18px system-ui, sans-serif', color: '#ffe9c2', minHeight: '24px', maxWidth: '420px',
      textShadow: '0 2px 4px rgba(0,0,0,0.7)', marginTop: '4px',
    } as CSSStyleDeclaration);
    this.coopStatus = coopStatus;

    // Text-only Back link, shown only while the How-to-Play panel is open.
    const back = document.createElement('div');
    back.textContent = '← Back';
    Object.assign(back.style, {
      font: '700 22px system-ui, sans-serif', color: '#ffe9c2', cursor: 'pointer',
      textShadow: '0 2px 4px rgba(0,0,0,0.6)', marginTop: '6px', display: 'none',
    } as CSSStyleDeclaration);
    back.addEventListener('click', () => { Sfx.play('uiClick', 0.8); this.hideHowTo(); });
    this.backBtn = back;

    root.append(logo, this.playBtn, this.coopBtn, this.howBtn, coopStatus, this.buildHowTo(), back);

    // Studio logo — pinned top-right, independent of the menu's flex flow (absolute), so opening
    // How-to-Play never moves it. Clicking opens the studio's X page in a new tab.
    const studioLink = document.createElement('a');
    studioLink.href = STUDIO_LINK;
    studioLink.target = '_blank';
    studioLink.rel = 'noopener noreferrer';
    Object.assign(studioLink.style, {
      position: 'absolute', top: 'clamp(18px, 3vh, 40px)', right: 'clamp(18px, 3vw, 44px)',
      display: 'block', cursor: 'pointer', pointerEvents: 'auto', zIndex: '110',
      transition: 'filter 0.15s, transform 0.15s',
    } as CSSStyleDeclaration);
    const studioLogo = document.createElement('img');
    Object.assign(studioLogo.style, {
      height: 'clamp(48px, 7vh, 84px)', width: 'auto', objectFit: 'contain',
      filter: 'drop-shadow(0 3px 8px rgba(0,0,0,0.55))',
    } as CSSStyleDeclaration);
    ENGINE.resolveAssetPathsInText(STUDIO_LOGO_URL).then((url) => { studioLogo.src = url; }).catch(() => { /* noop */ });
    studioLink.appendChild(studioLogo);
    studioLink.addEventListener('mouseenter', () => { studioLink.style.filter = 'brightness(1.2)'; studioLink.style.transform = 'scale(1.06)'; });
    studioLink.addEventListener('mouseleave', () => { studioLink.style.filter = 'none'; studioLink.style.transform = 'scale(1)'; });
    studioLink.addEventListener('click', () => Sfx.play('uiClick', 0.7));
    root.appendChild(studioLink);

    container.appendChild(root);
    this.root = root;
  }

  private playBtn: HTMLElement | null = null;
  private coopBtn: HTMLElement | null = null;
  private coopStatus: HTMLElement | null = null;
  private searching = false;
  private howBtn: HTMLElement | null = null;
  private backBtn: HTMLElement | null = null;
  private logoEl: HTMLElement | null = null;

  private makeButton(label: string, onClick: () => void): HTMLElement {
    const btn = document.createElement('div');
    btn.textContent = label;
    Object.assign(btn.style, {
      // Sized to the button_card art (280x95).
      width: '280px', height: '95px', boxSizing: 'border-box', margin: '2px 0',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      font: '700 30px system-ui, sans-serif', color: LEATHER_DARK, cursor: 'pointer',
      backgroundSize: '100% 100%', backgroundRepeat: 'no-repeat', transition: 'filter 0.1s',
    } as CSSStyleDeclaration);
    ENGINE.resolveAssetPathsInText(BTN_CARD_URL).then((url) => { btn.style.backgroundImage = `url('${url}')`; }).catch(() => { /* noop */ });
    // Hover: brighten the card.
    btn.addEventListener('mouseenter', () => { btn.style.filter = 'brightness(1.12)'; });
    btn.addEventListener('mouseleave', () => { btn.style.filter = 'none'; });
    btn.addEventListener('click', () => { Sfx.play('uiClick', 0.8); onClick(); });
    return btn;
  }

  private howToPanel: HTMLElement | null = null;
  private huntPage: HTMLElement | null = null;
  private ctrlPage: HTMLElement | null = null;
  private hLeft: HTMLElement | null = null;
  private hRight: HTMLElement | null = null;

  private buildHowTo(): HTMLElement {
    // Carousel: [◀] card [▶]. Page 0 = The Hunt (right arrow only), page 1 = Controls (left arrow only).
    const row = document.createElement('div');
    Object.assign(row.style, { display: 'none', alignItems: 'center', gap: '10px', marginTop: '22px' } as CSSStyleDeclaration);

    const card = document.createElement('div');
    Object.assign(card.style, {
      width: 'min(84vw, 500px)', maxHeight: '58vh', overflowY: 'auto',
      padding: '20px 24px', background: PANEL_BG, border: `3px solid ${PANEL_BORDER}`, borderRadius: '12px',
      color: LEATHER_DARK, font: '600 16px system-ui, sans-serif', lineHeight: '1.55',
      boxShadow: '0 8px 24px rgba(0,0,0,0.45)', boxSizing: 'border-box',
    } as CSSStyleDeclaration);

    // Page 0 — The Hunt.
    const hunt = document.createElement('div');
    hunt.appendChild(this.sectionTitle('The Hunt'));
    const steps: [string, string][] = [
      ['1. Hunt', 'Track down deer, rabbits, boars and bears out in the wild and take them down.'],
      ['2. Loot', 'Each kill drops meat, pelts and rare parts — grab them off the ground with F.'],
      ['3. Sell', 'Bring your loot to the merchant and sell it for gold.'],
      ['4. Upgrade', 'Spend gold at the gear shop on stronger weapons, arrows and potions — then hunt bigger prey.'],
      ['Co-op', 'Hunt Together pairs you with a partner. Gang up on boars and bears — a provoked animal goes after whoever hit it. Loot goes to whoever grabs it first.'],
    ];
    for (const [k, d] of steps) {
      const r = document.createElement('div');
      Object.assign(r.style, { margin: '2px 0 8px' } as CSSStyleDeclaration);
      const kk = document.createElement('div'); kk.textContent = k;
      Object.assign(kk.style, { fontWeight: '800', color: '#5a3410', fontSize: '17px' } as CSSStyleDeclaration);
      const dd = document.createElement('div'); dd.textContent = d;
      Object.assign(dd.style, { opacity: '0.9' } as CSSStyleDeclaration);
      r.append(kk, dd);
      hunt.appendChild(r);
    }

    // Page 1 — Controls.
    const ctrl = document.createElement('div');
    ctrl.style.display = 'none';
    ctrl.appendChild(this.sectionTitle('Controls'));
    const rows: [string, string][] = [
      ['WASD', 'Move'], ['Hold Middle Mouse', 'Look around'], ['Hold Shift', 'Sprint'], ['Q', 'Dash'], ['Space', 'Jump'],
      ['Left Click', 'Attack'], ['Right Click', 'Aim bow (hold to charge)'], ['1 – 4', 'Select weapon / potion'],
      ['B', 'Backpack'], ['T', 'Silicon Store'], ['F', 'Pick up loot'], ['Esc', 'Pause'], ['Walk up to a merchant', 'Buy gear / sell loot'],
    ];
    for (const [key, desc] of rows) {
      const r = document.createElement('div');
      Object.assign(r.style, { display: 'flex', justifyContent: 'space-between', gap: '16px', lineHeight: '1.7' } as CSSStyleDeclaration);
      const k = document.createElement('span'); k.textContent = key;
      Object.assign(k.style, { fontWeight: '800', color: '#5a3410', whiteSpace: 'nowrap' } as CSSStyleDeclaration);
      const d = document.createElement('span'); d.textContent = desc;
      Object.assign(d.style, { textAlign: 'right' } as CSSStyleDeclaration);
      r.append(k, d);
      ctrl.appendChild(r);
    }

    card.append(hunt, ctrl);
    const left = this.howToArrow('‹', () => this.setHowToPage(0));
    const right = this.howToArrow('›', () => this.setHowToPage(1));
    row.append(left, card, right);

    this.howToPanel = row;
    this.huntPage = hunt; this.ctrlPage = ctrl; this.hLeft = left; this.hRight = right;
    this.setHowToPage(0);
    return row;
  }

  private howToArrow(glyph: string, onClick: () => void): HTMLElement {
    const a = document.createElement('div');
    a.textContent = glyph;
    Object.assign(a.style, {
      flex: '0 0 auto', width: '46px', height: '46px', display: 'flex', alignItems: 'center', justifyContent: 'center',
      font: '700 46px system-ui, sans-serif', color: '#ffe9c2', cursor: 'pointer',
      textShadow: '0 2px 5px rgba(0,0,0,0.7)', userSelect: 'none',
    } as CSSStyleDeclaration);
    a.addEventListener('mouseenter', () => { a.style.filter = 'brightness(1.2)'; });
    a.addEventListener('mouseleave', () => { a.style.filter = 'none'; });
    a.addEventListener('click', () => { Sfx.play('uiClick', 0.7); onClick(); });
    return a;
  }

  private setHowToPage(p: number): void {
    if (this.huntPage) this.huntPage.style.display = p === 0 ? 'block' : 'none';
    if (this.ctrlPage) this.ctrlPage.style.display = p === 1 ? 'block' : 'none';
    // Use visibility (not display) so the hidden arrow keeps its slot and the card never shifts.
    if (this.hLeft) this.hLeft.style.visibility = p === 1 ? 'visible' : 'hidden';   // left arrow only on page 2
    if (this.hRight) this.hRight.style.visibility = p === 0 ? 'visible' : 'hidden'; // right arrow only on page 1
  }

  private sectionTitle(text: string): HTMLElement {
    const t = document.createElement('div');
    t.textContent = text;
    Object.assign(t.style, {
      font: '800 20px system-ui, sans-serif', color: LEATHER_DARK, margin: '4px 0 10px',
      borderBottom: `2px solid ${PANEL_BORDER}`, paddingBottom: '4px',
    } as CSSStyleDeclaration);
    return t;
  }

  private showHowTo(): void {
    if (this.logoEl) this.logoEl.style.display = 'none'; // free room for the panel + Back
    // Logo hidden → centre the panel instead of leaving it pinned top-left.
    if (this.root) Object.assign(this.root.style, { alignItems: 'center', justifyContent: 'center', paddingLeft: '0', paddingTop: '0' } as CSSStyleDeclaration);
    if (this.playBtn) this.playBtn.style.display = 'none';
    if (this.coopBtn) this.coopBtn.style.display = 'none';
    if (this.coopStatus) this.coopStatus.style.display = 'none';
    if (this.howBtn) this.howBtn.style.display = 'none';
    if (this.howToPanel) this.howToPanel.style.display = 'flex';
    this.setHowToPage(0); // always open on The Hunt
    if (this.backBtn) this.backBtn.style.display = 'block';
  }

  private hideHowTo(): void {
    if (this.logoEl) this.logoEl.style.display = 'block';
    // Restore the left/top-anchored title-screen layout.
    if (this.root) Object.assign(this.root.style, { alignItems: 'flex-start', justifyContent: 'flex-start', paddingLeft: 'clamp(48px, 8vw, 130px)', paddingTop: 'clamp(40px, 9vh, 120px)' } as CSSStyleDeclaration);
    if (this.playBtn) this.playBtn.style.display = 'flex';
    if (this.coopBtn) this.coopBtn.style.display = 'flex';
    if (this.coopStatus) this.coopStatus.style.display = 'block';
    if (this.howBtn) this.howBtn.style.display = 'flex';
    if (this.howToPanel) this.howToPanel.style.display = 'none';
    if (this.backBtn) this.backBtn.style.display = 'none';
  }

  /** Hunt Together: queue for a 2-hunter co-op match, or cancel the search in progress. */
  private toggleCoopSearch(): void {
    const gameLoop = this.getWorld()?.gameLoop;
    if (!gameLoop || this.transitioning) return;
    if (this.searching) {
      void gameLoop.cancelMatch().catch(() => { /* already over */ });
      return;
    }
    this.searching = true;
    this.setCoopLabel('Cancel');
    this.setCoopStatus('Looking for a hunting partner...');
    gameLoop.findMatch({
      queueId: 'solo-1v1', // two players per match: a co-op hunting duo
      onStatus: (status) => {
        if (status === 'PLACING') this.setCoopStatus('Partner found! Opening the hunting grounds...');
      },
    }).then(() => {
      // Connected: the server loads the hunting level and this menu leaves play with it.
      this.transitioning = true;
      this.root?.remove();
      this.root = null;
      const gc = this.getWorld()?.gameContainer;
      if (gc) LoadingScreen.show(gc); // stays up until the game pawn finishes preloading
    }).catch((e: unknown) => {
      this.searching = false;
      this.setCoopLabel('Hunt Together');
      if (e instanceof ENGINE.MatchmakingError && e.aborted) {
        this.setCoopStatus('');
        return;
      }
      console.warn('[MainMenu] matchmaking failed', e);
      this.setCoopStatus('Co-op is not available here. Play the published game while signed in, or hunt solo with Play.');
    });
  }

  private setCoopStatus(text: string): void {
    if (this.coopStatus) this.coopStatus.textContent = text;
  }

  private setCoopLabel(text: string): void {
    if (this.coopBtn) this.coopBtn.textContent = text; // the button's only content is its label
  }

  private startGame(): void {
    if (this.transitioning) return;
    if (this.searching) void this.getWorld()?.gameLoop?.cancelMatch().catch(() => { /* already over */ });
    this.transitioning = true;
    this.root?.remove();
    this.root = null;
    const gc = this.getWorld()?.gameContainer;
    if (gc) LoadingScreen.show(gc); // stays up until the game pawn finishes preloading
    const gameLoop = this.getWorld()?.gameLoop;
    if (!gameLoop) return;
    void gameLoop.openLevel(GAME_SCENE_URL);
  }
}
