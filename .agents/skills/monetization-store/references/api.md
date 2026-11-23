# Store APIs

The store template (v4.0.0 and later) talks only to the page's store host,
`window.genesysPlayStore`. `src/store/store-client.ts` wraps it; game code
calls neither the host nor any API directly. The host calls the two services
behind the store:

- Core (tsb-core-api) owns the game's items and each player's inventory of
  them: list, buy or claim, consume. It charges purchases through the store
  API and adds the item to the inventory before it answers.
- The store API keeps the Silicon balance and Test Silicon.

## Store host

On the Play page (`/play/<gameId>`) the game runs in its own frame, on its
own domain, and the Play page around it answers the host's calls. The Play
page signs the player in (a Sandbox account popup), confirms every priced
purchase on its own panel, opens Get Silicon, and decides real Silicon or
Test Silicon. The game sends only item ids and quantities: no tokens,
addresses, cookies or store context. A page without a host (a local folder,
`pnpm dev`) has no store: the panel says "Store unavailable here".

In desktop Play (the desktop app's play view, Play in New Window, Mobile
Preview) the page around the game answers the same contract with Test
Silicon only, for the owner of the project's linked game, on the creator
login of the desktop app's main window. The game id is the one the project
was linked to when Play started: `store-config.ts`'s `gameId` is not used
there, so linking takes effect on Restart Play. That host lists drafts
(`draft: true`) and published items (`draft: false`), sells both for Test
Silicon (until the website's desktop Play update reaches an environment, it sells only drafts there), lists items only to a
signed-in creator, and answers every method
with `GAME_NOT_LINKED`, `NOT_GAME_OWNER` or `GAME_NOT_FOUND` when the
project has no linked game, the creator does not own it, or core does not
know it.

Contract, version 1. The template declares these types itself in
`store-client.ts`, because a game cannot import platform code:

```ts
interface GenesysPlayStore {
  readonly version: 1;
  getBalance(): Promise<{ signedIn: boolean; silicon: number | null; test: boolean }>;
  getItems(): Promise<{ items: { itemId: string; name: string; description: string; imageUrl: string | null; price: number; consumable: boolean; draft?: boolean }[] }>;
  getInventory(): Promise<{ signedIn: boolean; items: { itemId: string; quantity: number }[] }>;
  acquire(itemId: string): Promise<{ status: 'acquired'; itemId: string; quantity: number } | { status: 'pending'; itemId: string }>;
  consume(itemId: string, quantity?: number): Promise<{ itemId: string; consumed: number; remaining: number }>; // quantity defaults to 1
  getSilicon(): Promise<void>;
  requestSignIn(): void;
  // returns an unsubscribe function; the reason is optional (a host may leave it out)
  onBalanceChanged(listener: (change: { reason?: 'purchase' | 'topUp' | 'account' }) => void): () => void;
}
```

- `price` is whole Silicon, `0` for a free item. `test: true` means the host
  plays with Test Silicon; the store only shows it.
- `draft` (desktop Play only): `true` for the owner's draft, `false` for a
  published item; the Play page leaves it out (it lists no drafts). With Test
  Silicon every priced item, draft or published, shows Buy with a Test
  Silicon price (TEST tag) and is sent to the host (Q48); a draft also shows
  its Draft chip. A free item is claimed as usual.
- Guests may list items. For a guest, `getBalance()` and `getInventory()`
  answer `{ signedIn: false }` (not an error); `acquire` (free items
  included) and `consume` answer `SIGN_IN_REQUIRED`, and on a guest's
  acquire the Play page opens its account panel.
- `acquire` answers `pending` when the purchase may still go through: the
  host got no final answer in time, or any answer that might hide a charge
  (a 5xx, a failure without a known code). It is never a failure: there is
  no idempotency key, so buying again could charge a consumable twice. The
  store shows "Purchase processing" and settles it (`purchased` or
  `claimed`) on the next read that shows the item. While the game tab is
  visible it reads the balance and the inventory every 5 s for 2 minutes
  after the last purchase went pending, then every 30 s up to 10 minutes;
  the panel opening, the game tab focused again and the next purchase or
  Get Silicon read too. Reads only: nothing is sent again. After 10 minutes
  the card stays Processing… for the session and the notice says "We
  couldn't confirm this purchase yet. Check your inventory and Silicon
  balance before buying it again."; a later read still settles it.
  Processing lasts for the session, across a sign-out and a change of
  account: the guest view does not show it and its reads pause; the read
  at the next sign-in becomes its new starting point (the host does not say
  who signed in), so it never settles against an inventory it did not
  start from and is never bought again in the session.
- `onBalanceChanged` fires with `{ reason }`: `purchase` after the Play
  page's own acquire answered (acquired or pending, before `acquire`
  answers), `topUp` when the player came back from a Get Silicon tab the
  Play page opened, `account` when the signed-in player changed (sign-in,
  sign-out, another account). It names no account and no amount. The store
  re-reads the balance and the inventory on every one. After `account` a
  purchase still processing is never settled against that inventory: it
  stays "Purchase processing", is never bought again, and `ready` fires so
  the game re-applies what the player owns. `purchase` and `topUp` settle
  normally. A host that gives no reason is read as before: a change that is
  neither the store's purchase nor its Get Silicon may be another account.
  The client turns a reason it does not know into none.
- Every rejection is an error with a `code` and maybe `data`:
  - `SIGN_IN_REQUIRED`: the player is not signed in. The store shows "Sign
    in to buy" and calls `requestSignIn()`, except after a `consume` (a
    use is the game's, not the player's press: the store shows the guest
    view and opens nothing). A guest's Buy or Claim
    (nothing is sent for a guest) goes on once the player signs in: within
    10 minutes, with the store still open and the item still buyable (never
    one still Processing…), the
    store calls `acquire` for that item once, so the purchase panel opens
    (a free item is claimed). It is forgotten after one use, on sign-out,
    when the store closes, or after 10 minutes. Desktop Play also answers it
    on `getItems`: the store then shows the guest view with its Sign in and
    no cards ("Sign in to the desktop app to test this game's store.", Get
    Test Silicon off), and loads in full once the creator signs in (the
    `account` change, or the read when the panel opens or the game tab is
    focused). The Play page lists items to guests, so there `getItems`
    answering it on load shows the error view with Retry.
  - `OPEN_TOP_LEVEL`: the Play page is itself inside a frame; every method
    answers it. The store shows "Open the game in its own tab to buy".
  - `CANCELLED`: the player closed the purchase panel. The store shows
    nothing. With `data { reason: 'getSilicon', shortfall }` the player
    picked Get Silicon on the panel (`shortfall` is price minus balance, or
    null when not short): nothing was sent and the tab is open. On the
    Play page the store shows its top-up bar ("Finish getting Silicon…"),
    counts the return as its own Get Silicon (no re-base), and re-reads the
    balance every 5 s for up to 10 minutes while the game tab is visible.
    With Test Silicon (desktop Play) the panel only says what was picked
    and refills nothing: the store then calls `getSilicon()` itself, as its
    own button does, so a refused refill (`RATE_LIMITED`, `UNAVAILABLE`)
    shows its line and the button comes back on. While that refill is on
    its way there is no top-up bar: both Get Test Silicon buttons read
    "Adding…" until the new balance is read, or for at most 15 s (then one
    more balance read). A game that calls `window.genesysPlayStore`
    directly must do the same, or the panel's Get Test Silicon refills
    nothing. On the Play page the store never calls `getSilicon()` after
    this answer.
  - `BUSY`: another purchase panel is open, or the last purchase is still
    being answered. The store shows "Your last purchase is still
    processing. Try again in a moment."
  - `PRICE_CHANGED` (`data.price` when known): the price changed while the
    panel was open; nothing was charged.
  - `INSUFFICIENT_FUNDS` (`data { balance, price, shortfall, currency }`).
  - `ALREADY_OWNED`, `ITEM_NOT_FOUND`, `NOT_PURCHASABLE`.
  - `ITEM_UNAVAILABLE` ("This item isn't available right now.") and
    `PURCHASE_LIMIT_EXCEEDED` ("You can't buy more of this item."): core's
    refusals; nothing was charged.
  - `ACCOUNT_CHANGED`: the signed-in account changed while the panel was
    open; nothing was charged. Purchases still processing stay Processing…
    for the session and re-base on the next read, so they never settle
    against the new account's inventory; the store re-reads behind the open
    cards.
  - `RATE_LIMITED` ("Too many requests. Wait a moment."): the host's own
    request limit; nothing was sent.
  - `REAL_COINS_DISABLED_IN_EDITOR` ("Published items can't be bought with
    Test Silicon here yet. Test the item as a draft for now."):
    desktop Play before the website's desktop Play update reaches that
    environment, which buys only drafts with Test Silicon (Q48; core also answers it for a game the signed-in
    creator does not own, which the store normally shows as not-owner
    first). Nothing was charged. The store re-reads nothing and never sends
    the purchase again; the card stays Buy. Desktop Play re-reads the
    catalog each time the store opens, so an item published or taken down
    to draft in Store Manager shows as it is now.
  - `TEST_PRICE_MISSING` ("This item can't be bought with Test Silicon yet.
    Try again in a minute."): desktop Play, a published item whose Test
    Silicon price is not there yet. Nothing was charged; the card stays Buy.
    The price appears once the item is saved again in Store Manager or the
    store's backfill has run; then Buy goes through.
  - `NOT_GAME_OWNER` ("Only this game's owner can test its store in desktop
    Play."): desktop Play of a game the signed-in creator does not own, on
    every method. The store shows that one line instead of its cards, with
    no Retry, no Buy and no balance (`phase: 'not-owner'`), and loads again
    when the account changes (`account`). Nothing was sent.
  - `GAME_NOT_LINKED`: desktop Play of a project with no linked game, on
    every method. The store shows "This project is not linked to a game yet.
    Link it in Store Manager (or ask the assistant), then restart Play."
    (`phase: 'unlinked'`). Nothing was sent.
  - `EDITOR_RELAY_REQUIRED` ("Purchases work only on the game's Play
    page."): core accepts real-money purchases only through the Play page.
  - `GAME_NOT_FOUND` ("This game has no store yet."): core does not know
    the game (consume; acquire answers it as `ITEM_NOT_FOUND`). On the Play
    page a load that answers it shows the error view with Retry; desktop
    Play answers it on every method, with no Retry, and there the line is "The game this project is linked to was
    not found. Check the link in Store Manager, then restart Play."
  - `UNAVAILABLE`: the store could not be reached. On acquire nothing was
    charged (the host answers `pending` when it might have been).
  - On consume, core's codes pass through: `NOT_OWNED`, `NOT_CONSUMABLE`,
    `INSUFFICIENT_QUANTITY` (`data.available` when present), `ITEM_NOT_FOUND`,
    `GAME_NOT_FOUND`. Any other consume failure (`UNAVAILABLE`, no answer, an
    unknown code) may hide a use that went through: the store re-reads the
    inventory, emits `consumed` if the quantity dropped, and otherwise shows
    "Could not confirm the item was used. Check your inventory before using it
    again." (`CONSUME_UNCONFIRMED`). It never invites a retry.
  - New codes may appear; the store shows a generic line naming the code.

The client turns rejections into
`StoreApiError { code, message, details }` (`details` is the host's `data`);
without a host every call rejects with `NO_STORE_HOST`.

## Core

What the host calls. Errors share `{ error: { code, message, details? } }`;
an invalid body is 400 `{ error: { code: "VALIDATION", issues } }`. Core
answers from its own database: a purchase, claim or consume shows in the
next read.

GET /v2/games/{gameId}/items (public)
: `{ items: GameItem[] }`, `GameItem = { id, gameId, name, description, imageUrl, price, consumable, draft, onSale, storeSku, createdAt, updatedAt }`.
  `price` is whole Silicon, `0` for a free item. Players get published items
  on sale; the game's owner also gets drafts and items off sale. 404
  `GAME_NOT_FOUND` when core does not know the game.

GET /v2/games/{gameId}/inventory (signed in)
: `{ items: [{ item: GameItem, quantity }] }`: every item of this game the
  player holds, deleted items included.

POST /v2/games/{gameId}/items/{itemId}/acquire (signed in) body `{ expectedPrice }` (optional)
: Free items are claimed, priced items paid in Silicon at once. Only the
  owner can buy drafts. `expectedPrice` is the price the player saw (whole
  Silicon, 0 for free); the Play page always sends it.
  `200 { itemId, orderId, currency: "coins" | "test-coins" | null, quantity }`
  (`currency` is `null` for a free claim; `quantity` is what the player now
  holds). `202 { itemId, pending: true }`: the outcome is unknown (the store
  took longer than 30 s, named no order yet, or failed with a 5xx and may
  have charged); if the store charged, the item arrives with core's daily
  check. Never retried.
  Errors: 401 `UNAUTHENTICATED`, 403 `EDITOR_RELAY_REQUIRED` (only while
  core's real-money switch is on: the call did not come through the Play
  page), 404 `GAME_NOT_FOUND` / `ITEM_NOT_FOUND` (also a draft or an item
  off sale the caller may not see), 409 `ALREADY_OWNED` (permanent, already
  held), 409 `INSUFFICIENT_FUNDS` with
  `details: { balance, price, shortfall, currency }`, 409 `PRICE_CHANGED`
  with `details: { price }` (the price is not `expectedPrice`; nothing was
  charged), 409 `NOT_PURCHASABLE`, 409 `ITEM_UNAVAILABLE`, 409
  `PURCHASE_LIMIT_EXCEEDED`, 409 `REAL_COINS_DISABLED_IN_EDITOR` (desktop
  Play: someone else's game), 409 `TEST_PRICE_MISSING` (desktop Play: a
  published item without its Test Silicon price yet), 502 `STORE_ERROR` (the
  store refused without a known code, or was never reached; nothing was
  charged).

POST /v2/games/{gameId}/inventory/{itemId}/consume (signed in) body `{ quantity }` (default 1)
: `{ itemId, consumed, remaining }`; at 0 the item leaves the inventory.
  Errors: 404 `NOT_OWNED`, 409 `NOT_CONSUMABLE`, 409 `INSUFFICIENT_QUANTITY`
  (`error.available` says how many are held).

## Store API

What the host and core call. It keeps the Silicon balance and Test Silicon;
real `coins` and fake `test-coins` (Test Silicon). Orders are priced in USD;
VAT and payment methods follow the player's country. Silicon packages
(`/api/payment/packages*`) are for the Sandbox top-up page only; games never
sell Silicon. Any store route can answer 503 `STORE_UNAVAILABLE` while the
store's database is unavailable.

The store API also has `POST /api/games/{gameId}/items/{sku}/acquire` and
`/claim`. Core calls them on the player's behalf; games never do.

## Item authoring (creators)

Items are created and edited in core by the game's owner, with the Studio
token. The editor's Store Manager and its MCP store tools are the normal way;
they reach core through the editor's own `/api/games/{gameId}/items` routes.

POST /v2/games/{gameId}/items
: Body `{ name, description?, imageUrl?, price, consumable?, draft?, onSale? }`:
  `name` 1 to 100 characters, `description` up to 500, `imageUrl` https,
  `price` whole Silicon from 0 (free) to 1,000,000, `consumable` (default
  false, fixed at creation), `draft` (default true), `onSale` (default
  true). `201 GameItem`. A new item is a draft. Every priced item has one
  amount: the owner's desktop Play pays it in Test Silicon, everyone else
  in Silicon (Q48).

PATCH /v2/games/{gameId}/items/{itemId}
: Any of `name`, `description`, `imageUrl` (https, or `null` to remove),
  `price`, `draft` (`false` publishes, `true` takes down), `onSale`.
  `consumable` must equal the current value (400 `CONSUMABLE_IMMUTABLE`).
  `200 GameItem`. Publishing and taking down change only who can see and
  buy the item; the price stays.

DELETE /v2/games/{gameId}/items/{itemId}
: Takes the item off the store and out of the game. Players who hold it keep
  it. `200 { success: true }`.

Errors: 401 `UNAUTHENTICATED`, 403 `NOT_GAME_OWNER`, 404 `GAME_NOT_FOUND`
(core learns of games from the editor's game webhook), 404
`ITEM_NOT_FOUND`, 502 when the store refused the change (nothing changed).

Core mirrors each item into the store's catalog (`storeSku`) and keeps the
two in step; games and creators never use the SKU.
