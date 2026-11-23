import * as ENGINE from '@gnsx/genesys.js';

import { StoreClient } from './store-client.js';
import { storeConfig, type StoreConfig, STORE_VERSION } from './store-config.js';
import { gameText, StoreController } from './store-controller.js';
import { PurchaseToast } from './ui/purchase-toast.js';
import { StoreHudButton } from './ui/store-hud-button.js';
import { StorePanel } from './ui/store-panel.js';

export interface InstalledStore {
  controller: StoreController;
  open(): void;
  close(): void;
  toggle(): void;
  destroy(): void;
}

/** Keyboard: the configured hotkey toggles the store, Escape closes it. Ignored while typing. */
class StoreHotkeyHandler extends ENGINE.BaseInputHandler {
  constructor(
    private readonly hotkey: string | null,
    private readonly controller: StoreController,
  ) {
    super();
  }

  public override handleKeyDown(e: KeyboardEvent): boolean {
    if (e.repeat || isTypingTarget(document.activeElement)) return false;
    const key = e.key.toLowerCase();
    if (key === 'escape' && this.controller.state.isOpen) {
      this.controller.close();
      return true;
    }
    if (this.hotkey && key === this.hotkey) {
      this.controller.toggle();
      return true;
    }
    return false;
  }
}

function isTypingTarget(element: Element | null): boolean {
  if (!element) return false;
  const tag = element.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || (element as HTMLElement).isContentEditable;
}

/**
 * Wires the store into a running game: client, controller, HUD chip, panel,
 * purchase toast, hotkey, pointer-lock handling and the balance re-read on focus.
 * Call from your GameMode's beginPlay; destroy() in endPlay.
 *
 * The store talks only to the page's store host, `window.genesysPlayStore`.
 * Without one (a local folder, `pnpm dev`) it shows "Store unavailable here".
 */
export async function installStore(
  world: ENGINE.World,
  overrides: Partial<StoreConfig> = {},
): Promise<InstalledStore> {
  const config: StoreConfig = { ...storeConfig, ...overrides };
  const uiManager = world.uiManager;
  const inputManager = world.inputManager;

  const client = new StoreClient();
  const controller = new StoreController({
    client,
    configuredGameId: config.gameId,
    runtimeGameId: world.netWorld.gameId,
  });

  const panel = new StorePanel(uiManager, {
    accent: config.accent,
    showSessionInfo: config.showSessionInfo,
    onClose: () => controller.close(),
    onGetSilicon: () => void controller.getSilicon(),
    onTab: (tab) => controller.setTab(tab),
    onRetry: () => void controller.refresh(),
    onLogin: () => controller.logIn(),
    onAction: (itemId, action) => {
      if (action === 'use') void controller.consume(itemId);
      else if (action !== 'owned') void controller.acquire(itemId);
    },
  });

  const hud = config.showHudChip
    ? new StoreHudButton(uiManager, {
        position: config.hudPosition,
        hotkey: config.hotkey,
        accent: config.accent,
        onOpen: () => controller.open(),
      })
    : null;

  const toast = new PurchaseToast();

  await Promise.all([panel.initialize(), toast.initialize(uiManager), hud?.initialize()]);

  const nameOf = (itemId: string): string => controller.state.items.find((item) => item.itemId === itemId)?.name ?? 'Item';
  const priceOf = (itemId: string): number | null => {
    const price = controller.state.items.find((item) => item.itemId === itemId)?.price;
    return price && 'coins' in price ? price.coins : null;
  };

  let pointerWasLocked = false;
  const unsubscribe = [
    controller.on('state', (state) => void panel.render(state)),
    controller.on('opened', () => {
      pointerWasLocked = inputManager.isPointerLocked();
      if (pointerWasLocked) inputManager.exitPointerLock();
    }),
    controller.on('closed', () => {
      if (pointerWasLocked) inputManager.requestPointerLock({ unadjustedMovement: true });
      pointerWasLocked = false;
    }),
    controller.on('purchased', ({ itemId }) => {
      console.info(`[Store] purchased ${itemId}`);
      toast.showPurchased(nameOf(itemId), priceOf(itemId), controller.state.currency === 'test-coins');
    }),
    controller.on('purchase-pending', ({ itemId, reason }) => {
      console.info(`[Store] purchase of ${itemId} is being processed (${reason === 'pending' ? 'the store host answered pending' : 'no readable answer'})`);
      toast.showProcessing(nameOf(itemId));
    }),
    controller.on('claimed', ({ itemId }) => {
      console.info(`[Store] claimed ${itemId}`);
      toast.showClaimed(nameOf(itemId));
    }),
    controller.on('consumed', ({ itemId, remainingQuantity }) => {
      console.info(`[Store] consumed ${itemId}, ${remainingQuantity} left`);
      toast.showConsumed(nameOf(itemId), remainingQuantity);
    }),
    controller.on('needs-coins', ({ itemId, shortfall }) =>
      console.info(`[Store] ${itemId} needs ${shortfall ?? '?'} more Silicon`),
    ),
    controller.on('signed-in', () => console.info('[Store] signed in')),
    controller.on('error', ({ code, message }) => console.warn(`[Store] ${code}: ${message}`)),
  ];

  // Coming back to the game tab re-reads the balance: a sign-in, sign-out or Get Silicon in
  // another tab shows up. Focus covers a second window that never hid this one; both firing
  // together share one read.
  const onVisible = (): void => {
    if (document.visibilityState === 'visible') void controller.refreshBalance();
  };
  const onFocus = (): void => void controller.refreshBalance();
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onFocus);

  const hotkeys = new StoreHotkeyHandler(config.hotkey, controller);
  inputManager.addInputHandler(hotkeys);

  await controller.init();
  const { gameId, gameIdSource, gameIdMismatch } = controller.state;
  const hostVersion = client.hostVersion();
  // In desktop Play the host serves the project's linked game: the line never names store-config.ts's id there.
  console.info(
    `[Store] v${STORE_VERSION}, ${gameText(controller.state)} via ${gameIdSource}, ${hostVersion === null ? 'no store host on this page' : `store host v${hostVersion}`}`,
  );
  if (gameIdMismatch) {
    console.warn(`[Store] store-config.ts gameId "${config.gameId}" differs from the running game "${gameId}"; using the running game.`);
  }

  return {
    controller,
    open: () => controller.open(),
    close: () => controller.close(),
    toggle: () => controller.toggle(),
    destroy: () => {
      for (const off of unsubscribe) off();
      inputManager.removeInputHandler(hotkeys);
      controller.destroy();
      panel.destroy();
      toast.destroy();
      hud?.destroy();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    },
  };
}
