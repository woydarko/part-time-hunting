# Components

Logic (`store-config.ts`, `store-client.ts`, `store-controller.ts`) is
engine-free. Components extend `ENGINE.BaseUIComponent`, load their template
and stylesheet from `@project/assets/ui/store/`, and compose UI kit widgets
with `mountChild`.

## installStore(world, overrides?) — `install-store.ts`

Builds the client and controller, mounts the HUD chip, panel and toast on
`world.uiManager`, registers the hotkey handler on `world.inputManager`,
wires pointer lock and the balance re-read on `visibilitychange` and window
`focus` (a sign-in or Get Silicon in another tab), logs `[Store] …` lines for
events and errors (the start-up line says whether the page has a store host
and its version), and calls `controller.init()` with
`world.netWorld.gameId`. It reads no address, token or flag from the page:
the client finds the host at `window.genesysPlayStore`.

## StoreController — `store-controller.ts`

`state: StoreState`:

- `phase`: `unavailable | unlinked | not-owner | loading | guest | ready | empty | error`
  (`unavailable`: the page has no store host, the Play page answered
  `OPEN_TOP_LEVEL`, or desktop Play's linked game is unknown to core
  (`GAME_NOT_FOUND`, no Retry: "The game this project is linked to was not found.
  Check the link in Store Manager, then restart Play."); `lastError.message`
  says which. `unlinked`: desktop Play's host
  answered `GAME_NOT_LINKED`. `not-owner`: desktop Play's host answered
  `NOT_GAME_OWNER`; the panel shows its line in the unavailable view, with
  no Retry, Buy or balance. `unlinked` and `not-owner` load in full again on
  an `account` change; `unavailable` is final)
- `isOpen`, `activeTab` (`shop | inventory`)
- `gameId`, `gameIdSource` (`runtime | config | none | host`; `host` in
  desktop Play, where `gameId` is null: the host serves the project's linked
  game and `store-config.ts`'s `gameId` is not used), `gameIdMismatch`
- `session` (`{ authenticated }`, null before the host's first answer),
  `balance`, `currency` (`coins`, or `test-coins` when the host plays with
  Test Silicon), `items: ItemView[]` (each with `owned`, `quantity`,
  `action`, `draft`), `inventory`
- `busyItemId`, `pendingItemIds` (purchases being processed: the host
  answered pending or gave no readable answer; each settles when the
  inventory shows the item; they last for the session, across a sign-out and
  a change of account, and are empty while the store shows the guest view),
  `unconfirmedItemIds` (the pending ones whose 10
  minutes of reads passed; still Processing…), `awaitingTopUp` (Get Silicon
  was asked of the host, by the store's button or the host's purchase panel;
  cleared when the balance changes or the panel closes, and with Test Silicon
  after 15 s), `shortfall`
  (Silicon missing for the last purchase; cleared when the balance changes),
  `lastError` (`{ code, message }`, the message from `storeErrorMessage`)

`ItemAction`: `buy | buy-again | claim | owned | processing`.
`processing` marks an item whose purchase is being processed: not buyable
again until it settles. Every priced item takes the host's currency: with
Test Silicon (desktop Play) drafts and published items alike show Buy
with a Test Silicon price (Q48; 4.0 had a `published` action instead).

Actions:

- `init()`, `refresh()`
- `open()`, `close()`, `toggle()`, `setTab(tab)`. `open()` re-reads the
  balance and the inventory; in desktop Play it also re-reads the catalog
  behind the cards, so an item taken down to draft, published or added in
  Store Manager shows as it is now (one read at a time; an answer that a
  sign-out, a gate or a newer load overtook applies nothing)
- `acquire(itemId)`: free items are claimed, priced items bought; the host
  confirms a priced purchase on its own panel first. Guests are asked to sign
  in instead; once they do (within 10 minutes, the store still open, the
  item still `buy`, `buy-again` or `claim`, never one still pending), the store calls `acquire` for
  that item once, so the host's panel opens (a free item is claimed). Nothing
  was sent for the guest, so this is no retry. `SIGN_IN_REQUIRED` from
  `acquire` counts as a guest's press too. One purchase at a time; a purchase is never sent twice. The
  host's answer sets the quantity held at once. `INSUFFICIENT_FUNDS` with a
  `shortfall` sets `shortfall` and emits `needs-coins` (the panel shows it next
  to Get Silicon). A `pending` answer, or one the client cannot read, adds the
  item to `pendingItemIds` and emits `purchase-pending` instead of an error;
  ignored while the item is pending. Every balance change from the host,
  `open()` and every refresh re-read the inventory, and `purchased` or
  `claimed` fires once the item shows up. While any purchase is pending and
  the game tab is visible the store also reads every 5 s for 2 minutes after
  the last one went pending, then every 30 s up to 10 minutes (reads only,
  through `refreshBalance()`; `destroy()` stops them). A purchase still
  pending after its 10 minutes moves to `unconfirmedItemIds`: it stays
  Processing… for the session, and a later read still settles it. After a
  balance change with reason `account` (or, from a host that gives no
  reason, one that was neither this store's purchase nor its Get Silicon),
  after `ACCOUNT_CHANGED`, and after the guest view (a sign-out or a
  `SIGN_IN_REQUIRED`), pending purchases are re-based on the next signed-in
  inventory read instead: they stay pending for the session and never settle
  against another account's items. Nothing forgets them. While the store
  shows the guest view the cards keep their Sign in buttons and the reads
  pause; both come back with the sign-in. Desktop Play's guest view (a
  sign-out, or a lapsed login) has no cards, keeps `currency` `test-coins`
  and Get Test Silicon off; the sign-in loads the cards in full. `CANCELLED` with `data.reason`
  `'getSilicon'` (the player picked Get Silicon on the host's panel) takes
  `shortfall` from the data when it is a number. On the Play page (the tab
  is open) it sets `awaitingTopUp` and counts the return as this store's Get
  Silicon. With Test Silicon (desktop Play, whose panel refills nothing) it
  calls `getSilicon()`, as the store's own button does, so a refused refill
  shows its line and the button comes back on
- `consume(itemId, quantity = 1)`: core's refusals pass through
  (`NOT_OWNED`, `NOT_CONSUMABLE`, `INSUFFICIENT_QUANTITY` with `available`,
  `ITEM_NOT_FOUND`, `GAME_NOT_FOUND`). Any other failure (`UNAVAILABLE`, no
  answer, an unknown code) re-reads the inventory: `consumed` if the quantity
  dropped by `quantity`, otherwise the `CONSUME_UNCONFIRMED` error ("Could
  not confirm the item was used. Check your inventory before using it
  again."). A use is never sent twice
- `getSilicon()`: asks the host to open Get Silicon; call it from the click
  itself. While `awaitingTopUp` and the game tab is visible, the balance is
  read every 5 s for up to 10 minutes, until it changes. With Test Silicon
  it does nothing while `awaitingTopUp` (`getSiliconDisabled(state)`), so
  refills do not stack, and the wait lasts at most 15 s: then
  `awaitingTopUp` clears, the balance is read once more, and a later change
  no longer counts as this store's Get Silicon
- `refreshBalance()`: re-reads the balance and the inventory, emits
  `balance-changed` on a change; switches the view in place when the player
  signed in or out since the last load (no loading screen), and emits `ready`
  after a sign-in, sign-out or another account; settles purchases being processed. Concurrent
  calls share one read, failures are ignored. A read that a purchase or a use
  answered during keeps the newer inventory, takes only the balance and reads
  once more. In desktop Play a read answered `NOT_GAME_OWNER` or
  `GAME_NOT_LINKED` shows that state at once (balance, inventory and cards
  cleared, `ready` so the game turns items off), and a signed-in read of a
  store without a catalog (a guest who saw no cards) loads in full.
  `checkSession()` is the same
- `logIn()`: asks the host to sign the player in (on the Play page, the
  Sandbox account popup); the store switches to the player's view when the
  host reports the change
- Host codes: `SIGN_IN_REQUIRED` shows "Sign in to buy", turns the store into
  a guest and asks the host to sign in (not after `consume`: sign-in starts
  only from Buy, Claim or Sign in); `OPEN_TOP_LEVEL` shows "Open the game in its
  own tab to buy"; `CANCELLED` shows nothing; `BUSY` shows "Your last
  purchase is still processing. Try again in a moment."; `PRICE_CHANGED`,
  `ITEM_NOT_FOUND`, `ALREADY_OWNED`, `ACCOUNT_CHANGED` and `NOT_OWNED`
  re-read the catalog, balance and inventory behind the open cards and keep
  the message: no loading state, actions stay allowed, and a failed read
  keeps the old cards. Only `init()` and `refresh()` (Retry) show `loading`.
  `REAL_COINS_DISABLED_IN_EDITOR` (desktop Play refusing a
  published item) and `TEST_PRICE_MISSING` (a published item without its
  Test Silicon price yet) show their line and re-read nothing
- `owns(itemId)`, `quantityOf(itemId)`
- `on(event, handler)` returns an unsubscribe function; `destroy()` also
  stops listening to the host

`storeErrorMessage(code, data?)` gives the player-facing line for a code;
an unknown code gets "Something went wrong (CODE). Try again in a moment."
Codes where a retry is wrong get lines that don't invite one:
`PURCHASE_LIMIT_EXCEEDED`, `ITEM_UNAVAILABLE`, `GAME_NOT_FOUND`,
`RATE_LIMITED`, `REAL_COINS_DISABLED_IN_EDITOR` ("Published items can't be bought with Test Silicon
here yet. Test the item as a draft for now."), `NOT_GAME_OWNER` ("Only this game's owner can test its
store in desktop Play."), `GAME_NOT_LINKED`, `EDITOR_RELAY_REQUIRED`,
`CONSUME_UNCONFIRMED`. `TEST_PRICE_MISSING` ("This item can't be bought
with Test Silicon yet. Try again in a minute.") does invite one: the Test
Silicon price appears once the item is saved again in Store Manager or the
store's backfill has run (`monetization-store/references/troubleshooting.md`). `NOT_GAME_OWNER` and `GAME_NOT_LINKED` on a purchase,
a use or Get Silicon are sure refusals: the store shows that state, with
nothing Processing or unconfirmed.
`getSiliconDisabled(state)`: whether Get Silicon is off (the store cannot
act, desktop Play's guest view, or Test Silicon is on its way, at most
15 s).
`guestText(state)`: the guest bar's line (the Play page's browsing line, or
in desktop Play "Sign in to the desktop app to test this game's store.").
`gameText(state)`: how the footer and
the start-up log name the game ("game <id>", "the project's linked game" in
desktop Play, or "game not linked").
`processingText(state)` gives the "Purchase processing: …" line, and for
`unconfirmedItemIds` "We couldn't confirm this purchase yet. Check your
inventory and Silicon balance before buying it again.";
`storeNotice(state)` gives the panel's inline notice, an action's error
followed by the processing line when both apply.

Events:

- `ready` `{ items, inventory, balance }`: the store loaded, or the player signed in, signed out or switched account while the game kept running; apply what `owns()` says both ways
- `purchased` `{ itemId, orderId }`: the item is in the inventory (`orderId` is always null)
- `purchase-pending` `{ itemId, reason: 'pending' | 'no-answer' }`: being processed; do not grant the item until `purchased` or `claimed`
- `claimed` `{ itemId }`
- `consumed` `{ itemId, remainingQuantity }`
- `balance-changed` `{ amount, currency }`
- `needs-coins` `{ itemId, shortfall }`
- `signed-in` `{ userId, username }` (both null: the host does not say who); follows `ready`, and the open panel switches in place, with no loading screen
- `opened`, `closed`
- `error` `{ code, message }`
- `state` (full snapshot on every change; the UI subscribes to this)

## StoreClient — `store-client.ts`

Wraps `window.genesysPlayStore` (read on every call; `new StoreClient({ host })`
injects another for tests) and declares its contract types locally
(`GenesysPlayStore`, `PlayStore*`), since a game cannot import platform code.
`hasHost()`, `hostVersion()`, `listItems()` (`GameItem { itemId, name,
description, price, consumable, imageUrl, draft }`, `price` is
`{ coins, currency: 'coins' }` or `{ free: true }`, `draft` true only for
the owner's drafts in desktop Play),
`getBalance()` (`{ currency, amount }`, or null when signed out),
`getInventory()` (`{ itemId, quantity }[]`, or null when signed out),
`acquire(itemId)` (`{ itemId, quantity, pending }`), `consume(itemId,
quantity = 1)` (`{ remainingQuantity }`), `getSilicon()`,
`requestSignIn()`, `onBalanceChanged(listener)` (the listener gets
`{ reason }`: `'purchase' | 'topUp' | 'account'`, or undefined when the host
gave none or one this version does not know; returns an unsubscribe
function). Host rejections become `StoreApiError { code, message, details }`
(`details` is the host's `data`); without a host every call rejects with
`NO_STORE_HOST`. The Play page answers a guest's balance and inventory
with `signedIn: false`; a `SIGN_IN_REQUIRED` read (a sign-out racing the
read) also means guest.

## StoreHudButton — `ui/store-hud-button.ts`

Options `position`, `hotkey`, `accent`, `onOpen`. Composes `ENGINE.Button`
("Shop") and `ENGINE.Keystroke`. Sizes to its content and hugs the configured
corner. On phones a chip at the top moves 56 px down, below the Play page's
fullscreen button and account pill.

## StorePanel — `ui/store-panel.ts`

Options `accent`, `showSessionInfo`, `onClose`, `onGetSilicon`, `onTab`,
`onRetry`, `onLogin`, `onAction(itemId, action)`.
Header with the balance chip, Get Silicon (`ENGINE.Button`, gold; its slot
keeps the old name `data-store-get-coins-slot`; "Get Test Silicon" with a
TEST tag on the balance when the host plays with Test Silicon) and a bare
close icon; text tabs Shop and Inventory with counts; guest bar with one
Sign in button and the line from `guestText(state)`; a gold top-up bar
(`topUpText(state)`: "You need N more Silicon for this item." or, while
`awaitingTopUp` on the Play page, "Finish getting Silicon…"; hidden while
Test Silicon is on its way, shortfall line included) with its own Get
Silicon button; both Get Silicon buttons take `getSiliconLabel(state)`
("Get Silicon", "Get Test Silicon", or "Adding…" while Test Silicon is on
its way); an inline notice for action errors and for purchases being
processed (both at once when both apply, so an error never hides
"Purchase processing"); grid of `StoreItemCard`; loading, empty, error, unlinked and
unavailable views (`not-owner` uses the unavailable view: one line, no
Retry); both Get Silicon buttons off while `getSiliconDisabled(state)`;
footer line
`store v<version> · <Signed in | Not signed in | not the game owner | no store host> [· test silicon] · <gameText>`.
`render(state)` is serialized; the latest state wins.

## StoreItemCard — `ui/store-item-card.ts`

One tile: art (the item image, or placeholder art per kind: potion for
consumables, crest for permanents, gift for free items), type chip, owned
count, a Draft chip with a dashed frame and watermark for drafts (desktop
Play only: the Play page lists no drafts), name,
two-line description, price row (a TEST tag on a Test Silicon price), one
`ENGINE.Button`.
`buttonSpecFor(view, mode, guest)` decides the label: Shop tab — Buy, Buy
another, Claim, Claimed, Owned, or Sign in to buy / Sign in to claim for
guests, or a disabled Processing… for `processing`; Inventory tab — Use or
Owned.

## PurchaseToast — `ui/purchase-toast.ts`

Wraps `ENGINE.Achievement`: `showPurchased(name, coins, test?)`,
`showClaimed(name)`, `showProcessing(name)` ("Purchase processing", with a
clock icon rather than the check), `showConsumed(name, remaining)`. On
phones it shows below the Play page's controls (the `store-toast` class in
`store-panel.css`).

## store-icons.ts

Developer-authored SVGs (icons and placeholder art), `formatCoins`,
`safeImageHtml(url, alt)` (https only, escaped attributes),
`accentButtonStyles(accent)`.
