# Troubleshooting

"Store unavailable here"
: The page has no store host (`window.genesysPlayStore`): a local folder,
  `pnpm dev`, or any page other than the Play page and desktop Play. The
  store calls nothing there. Play the game on the Play page or in desktop
  Play. Do not add a client of your own. In desktop Play it means the
  desktop app is older than its store host: update the desktop app.

"Open the game in its own tab to buy"
: The Play page is itself inside a frame (embedded in another page). It then
  refuses every store call, item list included. Open the game on its own
  Play page.

"This project is not linked to a game yet"
: Desktop Play: the project had no linked game when Play started. Link it in
  Store Manager, or run `genesys.actionStore({ action: 'linkGame' })` (both
  write `gameId` into `<project>.genesys-project`), then Restart Play.
  Desktop Play serves the game the project was linked to at play start;
  `store-config.ts`'s `gameId` is not used there, so editing it changes
  nothing.

"Only this game's owner can test its store in desktop Play" (`NOT_GAME_OWNER`)
: The creator signed in to the desktop app is not the owner of the
  project's linked game. The store shows only this line (no Retry, no Buy,
  no balance). Sign in as the owner in the desktop app's main window: the
  store loads without restarting Play. Anyone can play a published game on
  its Play page.

Test Silicon where real Silicon was expected, or the other way round
: The host decides, never the game: desktop Play uses Test Silicon, the Play
  page real Silicon. The store only shows what the host says (a TEST tag and
  "Get Test Silicon" with Test Silicon).

Guest although signed in, or "Sign in to buy"
: The player is not signed in on the Play page (the game frame never signs
  anyone in): the host answers the balance and the inventory with
  `{ signedIn: false }`, and an acquire with `SIGN_IN_REQUIRED` (the Play
  page then opens its account panel). Sign in asks the host, which opens the
  Sandbox account sign-in; the open store switches to the player's view in
  place (the game keeps running) when the host reports the change, or when
  the game tab is focused again. If the player had pressed Buy or Claim as a
  guest, the store then goes on to that item once (the purchase panel
  opens; a free item is claimed), within 10 minutes, only while the
  store stays open, and never for an item still being processed. A game's own
  `consume` answered `SIGN_IN_REQUIRED` shows the guest view but opens no
  sign-in: sign-in starts only from Buy, Claim or the Sign in button. Do not
  add token or sign-in handling to the game. In desktop Play the store
  follows the creator login of the desktop app's main window and lists no
  items to a guest: its guest bar says "Sign in to the desktop app to test
  this game's store." and Get Test Silicon is off. Sign in there, and the
  store loads its cards when the host reports the change, or when the panel
  opens or the game tab is focused again.

404 `GAME_NOT_FOUND` from core, or "This game has no store yet"
: Core learns of a game from the website's game webhook when the game is
  created. A game created on a local website (local database) never reaches
  core: link the project to a game created on the deployed website. On the
  Play page the store shows "This game has no store yet." with Retry. In
  desktop Play there is no Retry, and the line is "The game this project is linked to was not found. Check
  the link in Store Manager, then restart Play.": the linked game was
  deleted, or it belongs to another environment than the desktop app's.

Console warning "store-config.ts gameId differs from the running game"
: The published game passed a different id than the config. The running game
  wins. Desktop Play never reads the config's id (it serves the project's
  linked game); set `store-config.ts` to the same id to drop the warning.

Empty store although items exist
: The items belong to another game id, they are drafts (the Play page lists
  published items only), or they are off sale. The store shows exactly what
  the host lists. Check the items in Store Manager.

Draft items visible to a player
: They are not; core lists drafts only to the game's owner, and the Play
  page lists published items only. Desktop Play shows them to the owner,
  with a Draft chip.

A "Published" button that cannot be pressed, "Take it down to draft to test"
: The game has an older store template (4.0). Update the store
  templates (install script): from 4.1.0 desktop Play shows Buy on every
  priced item, drafts and published items alike, and buys them all with
  Test Silicon.

"Something went wrong (CODE)"
: The host answered a code this store version does not know. Nothing is
  retried. Update the store templates (install script); if the code stays,
  it is a host problem.

"The store is not reachable right now" (`UNAVAILABLE`)
: The store or core could not be reached. For a purchase this means nothing
  was charged (an answer that might hide a charge is "Purchase processing"
  instead); the player may buy again. Game code never retries a purchase or a
  use on its own.

"Could not confirm the item was used" (`CONSUME_UNCONFIRMED`)
: A use got no clear answer and the inventory does not show it. It may still
  go through: check the inventory before using the item again. Never retry a
  use from game code; one item could be used twice.

"You can't buy more of this item" (`PURCHASE_LIMIT_EXCEEDED`), "This item isn't available right now" (`ITEM_UNAVAILABLE`)
: Core refused the purchase; nothing was charged. Buying again gets the same
  answer until the creator changes the item.

"Published items can't be bought with Test Silicon here yet" (`REAL_COINS_DISABLED_IN_EDITOR`)
: Until the website's desktop Play update reaches that environment, desktop
  Play buys only drafts with Test Silicon (Q48). Nothing was charged. Test
  the item as a draft for now; published items work once the update is there. Core also answers this code for a
  creator who does not own the game: only the game's owner tests its store
  in desktop Play.

"This item can't be bought with Test Silicon yet" (`TEST_PRICE_MISSING`)
: Desktop Play, a published item whose Test Silicon price is not there yet.
  Nothing was charged. The price appears once the item is saved again in
  Store Manager (any edit writes both prices) or the store's backfill has
  run; then Buy goes through. It is a store problem, not the game's.

"Too many requests. Wait a moment." (`RATE_LIMITED`)
: The game asked the host too often (a loop calling the store). Nothing was
  sent; slow the calls down.

"Your last purchase is still processing" (`BUSY`)
: A purchase panel is already open on the Play page, or its last purchase
  is still being answered. Nothing was sent for this one; buy again in a
  moment. An item still Processing… cannot be bought again.

"The price of this item changed" (`PRICE_CHANGED`)
: The creator changed the price while the purchase panel was open. Nothing
  was charged; the store re-reads behind the open cards (no loading screen,
  the game keeps running), so the card shows the new price.

"You signed in with another account" (`ACCOUNT_CHANGED`)
: The player signed in as someone else, or out, in another tab while the
  panel was open. Nothing was charged; the store re-reads as the account now
  signed in. A purchase still Processing… stays so for the session.

`INSUFFICIENT_FUNDS`
: Handled: the panel shows "You need N more Silicon" with a Get Silicon
  button. If it does not show, `install-store.ts` no longer subscribes the
  panel to `state`.

`ALREADY_OWNED` on a permanent item
: The card should already show Owned. The store re-reads after this answer;
  if the card still shows Buy, `store.controller.refresh()`.

"Purchase processing", or a bought item not in the inventory right after the purchase
: The host answered `pending`: the purchase may still go through. Handled,
  nothing to retry: the card shows Processing… and, while the game tab is
  visible, the store re-reads the balance and the inventory every 5 s for 2
  minutes, then every 30 s up to 10 minutes (reads only); it also reads
  when the panel opens, when the game tab is focused and on the next
  purchase or Get Silicon. `purchased` fires once the item arrives.
  When core itself answered pending (it waited 30 s for the store, the store
  named no order, or the store failed and may have charged), only core's
  daily check grants the item: if the store charged, it arrives within a day,
  usually after the game was closed. A card still Processing… when the game
  reloads therefore does not mean the purchase failed: the balance shows
  whether anything was charged, and a charged item arrives with the daily
  check. Processing lasts for the session, across a sign-out, a sign-in and
  a switch of account: the guest view does not show it and its reads pause.
  The host does not say who signed in, so the read at the next sign-in
  becomes its new starting point: it settles if the item arrives after
  that, and otherwise stays Processing… for the session (even for the same
  player, if it landed while signed out). It is never bought again in the
  session.

"We couldn't confirm this purchase yet"
: A purchase still Processing… after 10 minutes of reads. It may have
  charged, so the card stays Processing… for the session and the store
  stops reading on its own; the panel opening or the game tab focused again
  still reads, and `purchased` fires if the item arrives. The player checks
  the inventory and the Silicon balance before buying it again (after a
  reload of the game, the Play page's purchase panel warns about the same
  item for 30 minutes).

Get Silicon does nothing
: The host opens it, from the click. Code that calls
  `controller.getSilicon()` after an `await` or a timer can be blocked by the
  browser.

"Get Test Silicon" is greyed out, or reads "Adding…"
: Test Silicon was asked for and has not landed yet, so refills do not
  stack. It turns back on when the new balance is read, after at most 15 s
  (the store then reads the balance once more), when the panel closes, or
  at once when the refill was refused (its line shows, for example "Too
  many requests. Wait a moment."). It is also off when the store shows no
  player's view (not the owner, no linked game, no store host, or desktop
  Play's guest view: sign in to the desktop app first).

The balance did not change after a top-up
: The store re-reads it when the host reports a change, when the game tab
  is visible or focused again, and every 5 s for up to 10 minutes after Get
  Silicon (the store's button, or Get Silicon on the purchase panel) while
  the game tab is visible; after Get Test Silicon for up to 15 s, then once
  more. Xsolla credits a moment after the payment;
  `store.controller.refreshBalance()` forces a read.

A card is declined or priced in an unexpected currency on the top-up page
: Not a store problem: the top-up page owns the checkout. Orders are priced
  in USD; VAT and payment methods follow the player's country.

Hotkey does nothing
: Another input handler consumed the key, or focus is in a text field (the
  store ignores keys while typing). Change `hotkey` in `store-config.ts`, or
  open via the HUD chip or `store.open()`.

Pointer lock stays off after closing
: Pointer lock needs a user gesture; if the panel was closed by code, the
  next click re-locks. Escape or the close button restores it.

Items created but the store shows old data
: Core answers from its database, so a change shows at the next catalog
  read. On the Play page reopening the store re-reads only the balance and
  the inventory: call `store.controller.refresh()`. In desktop Play opening
  the store re-reads the catalog too.

Store templates behind the shipped ones
: The footer shows `store v<version>`; the shipped version is
  `STORE_VERSION` in `monetization-store-components/templates/src/store/store-config.ts`.
  Rerun the install script; it updates every file except `store-config.ts`.
