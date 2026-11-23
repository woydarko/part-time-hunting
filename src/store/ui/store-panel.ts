import * as ENGINE from '@gnsx/genesys.js';

import { STORE_VERSION } from '../store-config.js';

import { gameText, getSiliconDisabled, guestText, storeNotice, type ItemView, type StoreState, type StoreTab } from '../store-controller.js';
import { StoreItemCard, type CardAction, type CardMode } from './store-item-card.js';
import {
  ALERT_ICON_SVG,
  BAG_ICON_SVG,
  CLOSE_ICON_SVG,
  COIN_ICON_SVG,
  LOCK_ICON_SVG,
  PLUS_ICON_SVG,
  USER_ICON_SVG,
  accentButtonStyles,
  formatCoins,
} from './store-icons.js';

export interface StorePanelOptions extends ENGINE.BaseUIComponentOptions {
  accent?: string | null;
  /** Show the low-opacity session line (store version, signed-in state, test silicon, game id) in the footer. */
  showSessionInfo?: boolean;
  onClose?: () => void;
  /** Get Silicon: the store host opens it. Call it from the click itself. */
  onGetSilicon?: () => void;
  onTab?: (tab: StoreTab) => void;
  onRetry?: () => void;
  onLogin?: () => void;
  onAction?: (itemId: string, action: CardAction) => void;
}

/**
 * The store dialog: header (balance, Get Silicon, close), Shop / Inventory tabs,
 * an auto-fill grid of StoreItemCard (two columns on phones in portrait, more in
 * landscape), and one view per non-ready state.
 * Renders from StoreState; owns no logic.
 */
export class StorePanel extends ENGINE.BaseUIComponent<StorePanelOptions> {
  private backdrop: HTMLElement | null = null;
  private pressStartedOnBackdrop = false;
  private releasedOnBackdrop = false;
  private balanceElement: HTMLElement | null = null;
  private testTagElement: HTMLElement | null = null;
  private gridElement: HTMLElement | null = null;
  private inventoryEmpty: HTMLElement | null = null;
  private errorMessage: HTMLElement | null = null;
  private notice: HTMLElement | null = null;
  private sessionInfo: HTMLElement | null = null;
  private guestBar: HTMLElement | null = null;
  private guestLine: HTMLElement | null = null;
  private topUpBar: HTMLElement | null = null;
  private topUpText: HTMLElement | null = null;
  private unavailableMessage: HTMLElement | null = null;
  private headerButton: ENGINE.Button | null = null;
  private topUpButton: ENGINE.Button | null = null;
  private stateElements = new Map<string, HTMLElement>();
  private tabButtons = new Map<StoreTab, HTMLElement>();
  private tabCounts = new Map<StoreTab, HTMLElement>();
  private cards = new Map<string, StoreItemCard>();
  private cardMode: CardMode = 'shop';
  private lastState: StoreState | null = null;
  private rendering = false;
  private pendingState: StoreState | null = null;

  protected override getAssetPaths(): { templatePath: string; stylesPath: string } {
    return {
      templatePath: '@project/assets/ui/store/store-panel.html',
      stylesPath: '@project/assets/ui/store/store-panel.css',
    };
  }

  protected override getDefaultOptions(): Required<StorePanelOptions> {
    return {
      position: 'none',
      visible: true,
      customClasses: [],
      customStyles: {},
      accent: null,
      showSessionInfo: true,
      onClose: () => undefined,
      onGetSilicon: () => undefined,
      onTab: () => undefined,
      onRetry: () => undefined,
      onLogin: () => undefined,
      onAction: () => undefined,
    };
  }

  protected override getInitialData(): Record<string, unknown> {
    return {};
  }

  protected override cacheElements(): void {
    if (!this.layout) return;
    this.backdrop = this.layout.querySelector('[data-store-backdrop]');
    // A tap on the dimmed area around the panel closes it; taps inside never do,
    // nor does a press that starts inside the panel and ends on the backdrop (a text selection)
    // or one that starts on the backdrop and ends inside the panel.
    this.backdrop?.addEventListener('pointerdown', (event) => {
      this.pressStartedOnBackdrop = event.target === this.backdrop;
    });
    this.backdrop?.addEventListener('pointerup', (event) => {
      this.releasedOnBackdrop = event.target === this.backdrop;
    });
    this.backdrop?.addEventListener('click', (event) => {
      const startedOnBackdrop = this.pressStartedOnBackdrop;
      const releasedOnBackdrop = this.releasedOnBackdrop;
      this.pressStartedOnBackdrop = false;
      this.releasedOnBackdrop = false;
      if (startedOnBackdrop && releasedOnBackdrop && event.target === this.backdrop) this.options.onClose();
    });
    this.balanceElement = this.layout.querySelector('[data-store-balance]');
    this.testTagElement = this.layout.querySelector('[data-store-test-tag]');
    this.gridElement = this.layout.querySelector('[data-store-grid]');
    this.inventoryEmpty = this.layout.querySelector('[data-store-inventory-empty]');
    this.errorMessage = this.layout.querySelector('[data-store-error-message]');
    this.notice = this.layout.querySelector('[data-store-notice]');
    this.sessionInfo = this.layout.querySelector('[data-store-session-info]');
    this.guestBar = this.layout.querySelector('[data-store-guest-bar]');
    this.guestLine = this.layout.querySelector('[data-store-guest-text]');
    this.unavailableMessage = this.layout.querySelector('[data-store-unavailable-message]');
    this.topUpBar = this.layout.querySelector('[data-store-topup-bar]');
    this.topUpText = this.layout.querySelector('[data-store-topup-text]');
    for (const tab of ['shop', 'inventory'] as StoreTab[]) {
      const button = this.layout.querySelector(`[data-store-tab="${tab}"]`) as HTMLElement | null;
      const count = this.layout.querySelector(`[data-store-tab-count="${tab}"]`) as HTMLElement | null;
      if (button) this.tabButtons.set(tab, button);
      if (count) this.tabCounts.set(tab, count);
    }
    for (const name of ['loading', 'empty', 'error', 'unlinked', 'unavailable']) {
      const element = this.layout.querySelector(`[data-store-state="${name}"]`);
      if (element) this.stateElements.set(name, element);
    }
  }

  protected override async onInitialize(): Promise<void> {
    const slot = (selector: string): HTMLElement => {
      const element = this.layout?.querySelector(selector);
      if (!element) throw new Error(`Store panel template is missing ${selector}.`);
      return element;
    };
    const icon = (selector: string, svg: string): void => {
      const element = this.layout?.querySelector(selector);
      if (element) element.innerHTML = svg; // trusted, developer-authored SVG
    };
    icon('[data-store-coin-icon]', COIN_ICON_SVG);
    icon('[data-store-guest-icon]', USER_ICON_SVG);
    icon('[data-store-topup-icon]', COIN_ICON_SVG);
    icon('[data-store-empty-icon]', BAG_ICON_SVG);
    icon('[data-store-error-icon]', ALERT_ICON_SVG);
    icon('[data-store-unlinked-icon]', LOCK_ICON_SVG);
    icon('[data-store-unavailable-icon]', LOCK_ICON_SVG);

    this.headerButton = await this.mountChild(
      ENGINE.Button,
      {
        label: 'Get Silicon',
        variant: 'primary', // gold fill via .store-header CSS (decision: D + 2); never takes the project accent
        size: 'medium',
        icon: PLUS_ICON_SVG,
        // The store host decides what Get Silicon opens, Test Silicon included.
        onClick: () => this.options.onGetSilicon(),
      },
      slot('[data-store-get-coins-slot]'),
    );
    await this.mountChild(
      ENGINE.Button,
      { label: '', variant: 'ghost', size: 'medium', icon: CLOSE_ICON_SVG, onClick: () => this.options.onClose() },
      slot('[data-store-close-slot]'),
    );
    this.layout?.querySelector('[data-store-close-slot] .ui-button')?.setAttribute('aria-label', 'Close store');

    for (const [tab, button] of this.tabButtons) {
      button.addEventListener('click', () => this.options.onTab(tab));
    }
    if (this.options.accent) {
      (this.layout?.querySelector('.store-panel') as HTMLElement | null)?.style.setProperty('--store-accent', this.options.accent);
    }

    await this.mountChild(
      ENGINE.Button,
      {
        label: 'Sign in',
        variant: 'primary',
        size: 'medium',
        customStyles: accentButtonStyles(this.options.accent),
        // The store host signs the player in; the store reloads when it reports the change.
        onClick: () => this.options.onLogin(),
      },
      slot('[data-store-login-slot]'),
    );
    this.topUpButton = await this.mountChild(
      ENGINE.Button,
      { label: 'Get Silicon', variant: 'primary', size: 'medium', icon: PLUS_ICON_SVG, onClick: () => this.options.onGetSilicon() },
      slot('[data-store-topup-slot]'),
    );
    await this.mountChild(
      ENGINE.Button,
      { label: 'Retry', variant: 'secondary', size: 'medium', onClick: () => this.options.onRetry() },
      slot('[data-store-retry-slot]'),
    );
    await this.mountChild(
      ENGINE.Button,
      { label: 'Browse the Shop', variant: 'secondary', size: 'small', onClick: () => this.options.onTab('shop') },
      slot('[data-store-browse-slot]'),
    );

    if (this.lastState) await this.render(this.lastState);
  }

  /**
   * Renders a state snapshot. Safe to call on every controller `state` event:
   * renders are serialized (cards mount asynchronously) and the latest state
   * always wins; a failing render is logged instead of breaking the store.
   */
  public async render(state: StoreState): Promise<void> {
    this.lastState = state;
    if (!this.backdrop) return;
    if (this.rendering) {
      this.pendingState = state;
      return;
    }
    this.rendering = true;
    try {
      await this.renderNow(state);
    } catch (error) {
      console.error('[Store] panel render failed', error);
    } finally {
      this.rendering = false;
      const next = this.pendingState;
      this.pendingState = null;
      if (next) void this.render(next);
    }
  }

  private async renderNow(state: StoreState): Promise<void> {
    if (!this.backdrop) return;

    this.backdrop.hidden = !state.isOpen;
    if (this.balanceElement) {
      this.balanceElement.textContent = state.balance === null ? '—' : formatCoins(state.balance);
    }
    const testMode = state.currency === 'test-coins';
    if (this.testTagElement) this.testTagElement.hidden = !(testMode && state.balance !== null);
    // "Adding…" while Test Silicon is on its way: desktop Play shows no top-up bar for it.
    this.headerButton?.setLabel(getSiliconLabel(state));
    this.topUpButton?.setLabel(getSiliconLabel(state));
    // Off while the store cannot act, and while Test Silicon is on its way (refills would stack).
    const getSiliconOff = getSiliconDisabled(state);
    this.headerButton?.setDisabled(getSiliconOff);
    this.topUpButton?.setDisabled(getSiliconOff);

    const ownedViews = state.items.filter((view) => view.owned && view.quantity > 0);
    for (const [tab, button] of this.tabButtons) {
      button.setAttribute('aria-selected', String(state.activeTab === tab));
    }
    const counts: Record<StoreTab, number> = { shop: state.items.length, inventory: ownedViews.length };
    for (const [tab, element] of this.tabCounts) {
      element.textContent = counts[tab] > 0 ? String(counts[tab]) : '';
    }

    const showGrid = state.phase === 'ready' || (state.phase === 'guest' && state.items.length > 0);
    // Not the owner (desktop Play) shows its one line in the unavailable view: no Retry, no cards.
    const stateView = state.phase === 'not-owner' ? 'unavailable' : state.phase;
    for (const [name, element] of this.stateElements) {
      element.hidden = stateView !== name;
    }
    if (this.guestBar) this.guestBar.hidden = state.phase !== 'guest';
    // Desktop Play has nothing to browse as a guest: its line asks for the desktop app's sign-in.
    if (this.guestLine) this.guestLine.textContent = guestText(state);
    // Short on Silicon, or waiting for Get Silicon on the Play page (Q30).
    if (this.topUpBar) {
      const text = topUpText(state);
      this.topUpBar.hidden = text === null;
      if (this.topUpText && text) this.topUpText.textContent = text;
    }
    // Messages come from the controller (storeErrorMessage); unknown codes name themselves.
    if (this.errorMessage && state.lastError) this.errorMessage.textContent = state.lastError.message;
    if (this.unavailableMessage) this.unavailableMessage.textContent = state.lastError?.message ?? 'Store unavailable here';
    // An action failed while the catalog itself is fine, and purchases still being processed: say both inline.
    if (this.notice) {
      const notice = storeNotice(state);
      this.notice.hidden = notice === null;
      this.notice.dataset.tone = notice?.tone ?? 'info';
      if (notice) this.notice.textContent = notice.text;
    }
    if (this.sessionInfo) {
      this.sessionInfo.textContent = this.options.showSessionInfo ? sessionInfoText(state) : '';
    }

    if (!this.gridElement) return;
    const views = state.activeTab === 'inventory' ? ownedViews : state.items;
    const mode: CardMode = state.activeTab === 'inventory' ? 'inventory' : 'shop';
    const gridVisible = showGrid && views.length > 0;
    this.gridElement.hidden = !gridVisible;
    if (this.inventoryEmpty) {
      this.inventoryEmpty.hidden = !(showGrid && state.activeTab === 'inventory' && views.length === 0);
    }
    if (!gridVisible) return;
    await this.renderCards(views, mode, state.busyItemId, state.phase === 'guest');
  }

  private async renderCards(views: ItemView[], mode: CardMode, busyItemId: string | null, guest: boolean): Promise<void> {
    if (!this.gridElement) return;
    if (mode !== this.cardMode) {
      // Cards keep per-mode button semantics; rebuild when switching tabs.
      for (const card of this.cards.values()) card.destroy();
      this.cards.clear();
      this.gridElement.replaceChildren();
      this.cardMode = mode;
    }
    const seen = new Set<string>();
    for (const view of views) {
      seen.add(view.itemId);
      let card = this.cards.get(view.itemId);
      if (!card) {
        const holder = document.createElement('div');
        holder.dataset.storeCardHolder = view.itemId;
        this.gridElement.appendChild(holder);
        card = await this.mountChild(
          StoreItemCard,
          { accent: this.options.accent, onAction: (itemId: string, action: CardAction) => this.options.onAction(itemId, action) },
          holder,
        );
        this.cards.set(view.itemId, card);
      }
      card.setView(view, mode, busyItemId === view.itemId, guest);
    }
    for (const [itemId, card] of this.cards) {
      if (seen.has(itemId)) continue;
      card.destroy();
      this.cards.delete(itemId);
      this.gridElement.querySelector(`[data-store-card-holder="${CSS.escape(itemId)}"]`)?.remove();
    }
  }

  protected override onDestroy(): void {
    this.cards.clear();
    this.stateElements.clear();
    this.tabButtons.clear();
    this.tabCounts.clear();
    this.backdrop = null;
    this.balanceElement = null;
    this.testTagElement = null;
    this.gridElement = null;
    this.inventoryEmpty = null;
    this.errorMessage = null;
    this.notice = null;
    this.sessionInfo = null;
    this.guestBar = null;
    this.guestLine = null;
    this.topUpBar = null;
    this.topUpText = null;
    this.unavailableMessage = null;
    this.headerButton = null;
    this.topUpButton = null;
    this.lastState = null;
  }
}

/**
 * "store v<version> · <Signed in | Not signed in> [· test silicon] · game <game id>", or the loading / unavailable
 * equivalent. In desktop Play the game is "the project's linked game" (gameText).
 */
export function sessionInfoText(state: StoreState): string {
  const parts: string[] = [`store v${STORE_VERSION}`];
  const session = state.session;
  if (state.phase === 'unavailable') parts.push(state.lastError?.code === 'NO_STORE_HOST' ? 'no store host' : 'store host unavailable');
  else if (state.phase === 'not-owner') parts.push('not the game owner');
  else if (!session) parts.push(state.phase === 'loading' ? 'Checking session…' : 'Session unknown');
  else parts.push(session.authenticated ? 'Signed in' : 'Not signed in');
  if (state.currency === 'test-coins') parts.push('test silicon');
  parts.push(gameText(state));
  return parts.join(' · ');
}

/**
 * The label of both Get Silicon buttons: "Adding…" while Test Silicon is on its way (until the new balance is read, at
 * most 15 s), otherwise "Get Test Silicon" or "Get Silicon".
 */
export function getSiliconLabel(state: Pick<StoreState, 'awaitingTopUp' | 'currency'>): string {
  if (state.currency !== 'test-coins') return 'Get Silicon';
  return state.awaitingTopUp ? 'Adding…' : 'Get Test Silicon';
}

/**
 * The top-up bar's line, or null to hide it. While Test Silicon is on its way the whole bar hides, the shortfall line
 * included: the buttons read "Adding…" instead (Q48).
 */
export function topUpText(state: Pick<StoreState, 'shortfall' | 'awaitingTopUp' | 'currency'>): string | null {
  const silicon = state.currency === 'test-coins' ? 'Test Silicon' : 'Silicon';
  if (state.currency === 'test-coins' && state.awaitingTopUp) return null;
  if (state.awaitingTopUp) {
    return 'Finish getting Silicon. Your balance updates here once it lands.';
  }
  if (state.shortfall !== null && state.shortfall > 0) {
    return `You need ${formatCoins(state.shortfall)} more ${silicon} for this item.`;
  }
  return null;
}
