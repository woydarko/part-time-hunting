---
name: monetization-store-components
description: Use when installing, updating, wiring, re-skinning, or replacing the in-game store's code — the `src/store/` controller and client, the `assets/ui/store/` UI components (HUD chip, Shop and Inventory panel, item tiles, Get Silicon, purchase toast) — or when the store's options, events, or state are needed. Start from `monetization-store` for what the store is.
metadata:
  tokens: 2824
---

# Monetization Store Components

`templates/` holds the store's source, copied into a game by
`scripts/install-store.mjs`:

- `src/store/store-config.ts` — `STORE_VERSION`, `StoreConfig`, `resolveGameId`.
- `src/store/store-client.ts` — typed wrapper of the page's store host
  (`window.genesysPlayStore`), engine-free.
- `src/store/store-controller.ts` — state machine, events and player-facing
  messages, engine-free.
- `src/store/install-store.ts` — `installStore(world, overrides?)`.
- `src/store/ui/*.ts` — components built on `ENGINE.BaseUIComponent`.
- `assets/ui/store/*.html`, `*.css` — templates and styles of the components.

## Install and update

`node .agents/skills/monetization-store-components/scripts/install-store.mjs`
from the project root:

- First run: copies both folders, writes `gameId` from
  `<project>.genesys-project` into `src/store/store-config.ts`, checks the
  engine (`.engine/src/ui/components`) has the widgets the store composes
  (`Button`, `Keystroke`, `Achievement`, `BaseUIComponent`), and prints the
  game-mode wiring.
- Later runs: compares `STORE_VERSION` in the project with the shipped one and
  overwrites every file except `store-config.ts` when the shipped version is
  newer, deletes files newer versions dropped, and prints what game code must
  change across a breaking version. Nothing else in the project is touched.
  The store runs with a kept `store-config.ts` from earlier versions: it
  reads only names and fields they all have.
- `--dry-run` lists what would be written. `--force` rewrites even when the
  versions match.

Wiring (once, by hand; the script prints it with the detected file):

```ts
import { installStore, type InstalledStore } from './store/index.js';

@ENGINE.GameClass()
class MyGameMode extends ENGINE.GameMode {
  private store: InstalledStore | null = null;

  public override beginPlay(): boolean {
    if (!super.beginPlay()) return false;
    const world = this.getWorld();
    if (world?.gameContainer) {
      void installStore(world)
        .then((store) => {
          this.store = store;
          store.controller.on('purchased', ({ itemId }) => { /* grant the effect */ });
          store.controller.on('claimed', ({ itemId }) => { /* same as purchased for free items */ });
          store.controller.on('consumed', ({ itemId }) => { /* apply the consumable */ });
        })
        .catch((error: unknown) => console.error('[Store] install failed', error));
    }
    return true;
  }

  public override endPlay(): boolean {
    if (!super.endPlay()) return false;
    this.store?.destroy();
    this.store = null;
    return true;
  }
}
```

`installStore` returns `InstalledStore { controller, open, close, toggle, destroy }`.
The `overrides` argument is a `Partial<StoreConfig>`.

## Where things happen

- Everything goes through the page's store host, `window.genesysPlayStore`
  (contract in `monetization-store/references/api.md`). On the Play page the
  page around the game frame answers it: it signs the player in, confirms
  every priced purchase on its own panel, opens Get Silicon, and decides real
  or Test Silicon. The template sends only item ids and quantities: no
  tokens, addresses or store context, and no request of its own. It holds no
  address at all.
- No host (a local folder, `pnpm dev`): the panel shows "Store unavailable
  here" (`phase: 'unavailable'`) and nothing is called.
- Host answers: `SIGN_IN_REQUIRED` shows "Sign in to buy", turns the store
  into a guest and asks the host to sign in (not after a game's `consume`);
  `OPEN_TOP_LEVEL` shows "Open the
  game in its own tab to buy" (on load, as the unavailable view);
  `CANCELLED` (the player closed the purchase panel) shows nothing, unless
  its data says `reason: 'getSilicon'` (the player picked Get Silicon on the
  panel): then the store waits for Silicon as after its own Get Silicon (the
  top-up bar on the Play page; with Test Silicon the store asks for the
  refill itself and the buttons read "Adding…"). A
  `pending` purchase shows "Purchase processing" and settles on the next
  read that shows the item. It lasts for the session: after a sign-out, a
  sign-in or an account switch the next signed-in read re-bases it, so it
  never settles against another account's inventory and is never bought
  again. While the game tab is visible the store reads every
  5 s for 2 minutes, then every 30 s up to 10 minutes; after that the card
  stays Processing… for the session and the notice asks the player to check
  the inventory and balance before buying again. Every other code has a line from
  `storeErrorMessage(code, data)`; an unknown code gets a generic line that
  names it. A purchase is never sent twice: there is no idempotency key, and
  a consumable would be charged again. A use (`consume`) without a clear
  answer is checked against the inventory, never sent again.
- Currency: `state.currency` follows the host's balance. With Test Silicon
  (`test-coins`) the balance shows a TEST tag, every price is Test Silicon
  (drafts and published items alike), and the header button reads "Get Test
  Silicon". While Test Silicon is on its way both Get Test Silicon buttons
  read "Adding…" and are off (refills do not stack) and the top-up bar
  hides, shortfall line included; that ends when the new balance is read,
  or after 15 s with one more balance read. `balance-changed` carries
  `{ amount, currency }`.
- Game id: `world.netWorld.gameId` when it is a real id (published game,
  Play page). In desktop Play (runtime id `"editor"`) the store host serves
  the project's linked game from play start: `gameIdSource` is `host`,
  `gameId` is null, and `store-config.ts`'s `gameId` is not used; only the
  host's `GAME_NOT_LINKED` makes the store unlinked. The footer and the
  start-up log then say "the project's linked game". Without a host the
  configured id only names the game there.
- Desktop Play (Test Silicon, the creator login): drafts (with their Draft
  chip) and published items are both bought with Test Silicon (Q48). A
  published item whose Test Silicon price is not there yet answers
  `TEST_PRICE_MISSING` ("This item can't be bought with Test Silicon yet.
  Try again in a minute."). Until the website's desktop Play update reaches
  that environment, published items are refused with
  `REAL_COINS_DISABLED_IN_EDITOR`: the store says "Published items can't be bought with Test Silicon here yet. Test the item as a draft for now." and re-reads nothing. A creator who does
  not own the game sees one line, "Only this game's owner can test its
  store in desktop Play.", with no Retry, Buy or balance
  (`phase: 'not-owner'`); a guest sees the guest bar and no cards. Both load
  in full when the account changes, without Restart Play. Switching from the
  owner to another account shows the not-owner line and clears the balance,
  inventory and cards.
- Pointer lock: exited when the panel opens, restored when it closes.
- Balance, inventory and sign-in: re-read when the panel opens, when the
  game tab is visible or focused again, and when the host reports a balance
  change, with a reason: `purchase`, `topUp` (back from Get Silicon) or
  `account` (signed in, signed out or another account). A sign-in or
  sign-out switches the view in place: no loading screen, and the game keeps
  running; `ready` fires so the game re-applies what the player owns, also
  after `account`. A guest's Buy or Claim goes on once the player signs in
  (within 10 minutes, store still open, item still buyable): the purchase
  panel opens for it, or a free item is claimed.
- Answers that change a card (`PRICE_CHANGED`, `ITEM_NOT_FOUND`,
  `ALREADY_OWNED`, `ACCOUNT_CHANGED`, `NOT_OWNED`) re-read behind the open
  cards: the grid, the scroll position and the actions stay. Only the first
  load and Retry show the loading state.
- Silicon: Get Silicon (`controller.getSilicon()`) asks the host, which opens
  it; games never sell Silicon. While the player waits, the balance is read
  every 5 s for up to 10 minutes (game tab visible) until it changes; Test
  Silicon waits at most 15 s, then reads the balance once more.
- Store version: `STORE_VERSION` is the first item of the footer line and of
  the `[Store] v…` start-up log, which also says whether the page has a host.
- Closing: a tap on the dimmed area around the centred panel closes it
  (press and release both on the dimmed area); taps inside never do.
- Updating from before v1.0.0: the install script deletes the old Get Silicon
  modal (`ui/get-coins-modal.ts`, `package-value.ts` and its assets). Game
  code that called `openGetCoins()` or `buyCoins()` switches to
  `getSilicon()`.
- Updating from before v2.0.0: items live in core and are named by item id.
  Events carry `{ itemId }` instead of `{ sku }`; `owns`, `quantityOf`,
  `acquire` and `consume` take the item id; `state.busySku` is
  `state.busyItemId`. Replace the SKUs in `src/store-items.ts` with the item
  ids from the Store Manager. The install script prints this when it updates.
- Updating from before v4.0.0: the install script deletes `core-api.ts` and
  `top-up.ts`. `refillTestCoins()`, `cancelLogIn()`, `returnedToGame()`, the
  `test-coins-refilled` event, `state.needsStudioLogin`, `loginPending` and
  `refillPending` are gone; `state.session` is `{ authenticated }`;
  `StoreClient` takes `{ host? }` and no game id. `apiBaseUrl` in the kept
  `store-config.ts` is no longer read. The install script prints this.
- Updating from before v4.1.0: `ItemAction` has no `published`; in desktop
  Play every priced item shows Buy in Test Silicon. Game code that checked
  for `published` drops the check. The install script prints this.

## Phones

The store switches to a phone layout when the game view is at most 600 px
wide or 480 px tall (CSS container queries on the store backdrops, so a small
editor play panel on a desktop gets it too). The panel fills the view; one
compact header row (title, balance, round gold + button, close); two-column
tiles without descriptions in portrait, more per row in landscape. The
panel's content starts 56 px down, and a HUD chip at the top and the
purchase toast move below the same line: the Play page keeps its fullscreen
button (top-right 64 x 64 px) and its account pill (a 56 px strip across
the top) above the game, so no store control sits under them. On touch
screens tiles do not lift on hover
and the HUD chip hides its key hint. Desktop and tablet keep the regular
layout. Safe-area padding (`env(safe-area-inset-*)`) only takes effect when
the page's viewport meta has `viewport-fit=cover`. Restyling for phones:
`references/customization.md`.

## References

- `references/components.md` — every component, its options, the controller's state and events.
- `references/customization.md` — config levers, copy, styles, opening from the world, replacing a component.
