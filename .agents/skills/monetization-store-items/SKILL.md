---
name: monetization-store-items
description: Use when a creator wants to add, price, edit, publish, take down, or delete an item in their game's store, give an item a gameplay effect, or test buying without spending money — item ids, drafts, free items, consumables, Silicon prices, item images. Start from `monetization-store` for what the store is.
metadata:
  tokens: 2353
---

# Monetization Store Items

Items belong to one game and live in core (tsb-core-api). Each has an
immutable item id (core's id), a name (up to 100 characters), a description
(up to 500), a price in whole Silicon (1 to 1,000,000) or Free, a type
(permanent: bought once and kept; consumable: used up and bought again,
stacks in the inventory), and an optional https image. The type cannot
change after creation.

## Before creating anything

Items shape the game's economy and take real money from players, so confirm
the intent before the first call. Ask, in one short message, only what the
request left open:

- What each item does in the game (the effect drives the type: an effect that
  is used up is a consumable, a lasting one is permanent).
- Permanent or consumable, when the effect leaves it ambiguous.
- Price in Silicon or free, and whether the creator wants a rough tier
  (small, medium, large) or exact numbers. Never invent prices silently.
- An image per item, or placeholder art for now.
- Publish right away, or keep as drafts to test in the editor with Test
  Silicon first (the default is draft).

Skip the questions when the creator already answered them; do not ask about
things the templates decide.

## Creating and managing items

Store Manager, in the editor's main menu, is where the creator can review
and edit the store themselves: it lists the items with their Draft or Live state and item id (copy button),
and offers New Item, Edit, Publish, Take Down and Delete. The image is an
https URL or a file uploaded to the game's assets. Every new item starts as
a draft.

Agents create and edit items through the editor's MCP tools, which run in
the editor with the creator's Studio login; no token is ever needed or
handled. The tools are hidden from the compact surface: call them through
`run_script` (`genesys.queryStore`, `genesys.actionStore`) or
`batch_execute`, after the readiness probe in the `genesys-mcp-orchestrator`
skill. A project must be open in the editor.

`genesys.queryStore({ operation })`:

- `getState` — game id (`null` until linked), whether `src/store` is installed, the store session (who the API recognises, environment, payment mode).
- `listItems` — every item including drafts and items off sale: `id`, `name`, `description`, `price` (whole Silicon, `0` is free), `consumable`, `imageUrl`, `draft`, `onSale`.

`genesys.actionStore({ action, ... })`:

- `linkGame` — no arguments, no approval. Registers the project as a game and writes `gameId` into `<project>.genesys-project`, as opening Store Manager does; returns `gameId` and `gameCreated` (false when it was already linked).

The item actions return the item's `itemId` (applied creates and edits also return the saved `item`). When the project is not linked yet they link it first and add `gameCreated: true`; mention the new game id to the creator.

- `createItem` — `name`, `description` (defaults to the name), `coins` or `free: true`, `consumable` (default false), optional https `imageUrl`. New items are drafts.
- `updateItem` — `itemId` plus any of `name`, `description`, `coins` / `free`, `imageUrl` (`null` removes the image).
- `publish` / `takeDown` — `itemId`.
- `deleteItem` — `itemId`; destructive.
- `setImage` — `itemId` and `filePath`: a PNG, JPEG or WebP anywhere on the computer (a file the creator dropped into the chat, or `@project/assets/...`), uploaded to the game's assets.

```js
// run_script(apply)
const created = await genesys.actionStore({ action: 'createItem', name: 'Storm Cloak', description: 'Walk through rain.', coins: 750, consumable: false });
await genesys.actionStore({ action: 'setImage', itemId: created.itemId, filePath: '/Users/me/Downloads/cloak.png' });
await genesys.actionStore({ action: 'publish', itemId: created.itemId });
```

When MCP is off, the agent cannot reach the editor: ask the creator to open
Store Manager (it links the game on open), create the item there and copy
its item id (each row shows it); do not ask for a token and do not propose
pasting scripts into the browser.

## After creating

Report every item with its item id, price, type and state. Say that new items
are drafts: only the creator sees them, in the editor, until they are
published, and that each can be changed or published later in the editor's
Store Manager or by asking here (publish, take down, change the price, set
an image, delete).

Published items on sale are readable by anyone from core:
`GET https://api-v2.sandbox.game/v2/games/<gameId>/items` (no token;
`api-v2-dev` for games on the dev editor). Drafts are listed only to the
game's owner.

Drafts: visible only to the game's owner, never to players. A published game
never lists or sells a draft. Desktop Play lists drafts (with a Draft chip)
and published items to the game's owner, and buys both with Test Silicon
(Q48).
Publish with Take Down
reversed: a taken down item disappears from the store; players who bought it
keep it.

Delete removes the item from the game for everyone; owners keep it in
their inventory. A deleted item never comes back; create a new item instead.

## Giving an item an effect

Core delivers items and keeps the inventory; the game decides what an item
does. Keep item ids in one file:

```ts
// src/store-items.ts: ids from the Store Manager or listItems
export const STORE_ITEMS = {
  lantern: '<item id>',
  healingHerb: '<item id>',
} as const;
```

Permanent items: apply the effect when the store is ready and after each
purchase or claim. `ready` fires again, without reloading the game, when the
player signs in, signs out or switches account on the Play page, so set the
effect both ways there. `purchased` and `claimed` fire only once the item is in
the inventory; a slow purchase first fires `purchase-pending` (show nothing
yet) and the store shows it as processing. The store checks for it every few
seconds while the game is visible; one that is not confirmed within 10
minutes stays processing for the session (it may have charged), and
`purchased` still fires if it arrives later. A guest who presses Buy or
Claim and then signs in goes on to that item: the Play page's purchase panel
opens for it, or a free item is claimed, and the usual events follow.

```ts
store.controller.on('ready', () => {
  setLantern(store.controller.owns(STORE_ITEMS.lantern)); // on, or off for a player who does not own it
});
store.controller.on('purchased', ({ itemId }) => { if (itemId === STORE_ITEMS.lantern) setLantern(true); });
store.controller.on('claimed', ({ itemId }) => { if (itemId === STORE_ITEMS.lantern) setLantern(true); });
```

Consumables: the player uses one from the Inventory tab, or the game consumes
one itself.

```ts
store.controller.on('consumed', ({ itemId, remainingQuantity }) => {
  if (itemId === STORE_ITEMS.healingHerb) heal(50);
});
// from gameplay, e.g. a hotkey:
if (store.controller.quantityOf(STORE_ITEMS.healingHerb) > 0) void store.controller.consume(STORE_ITEMS.healingHerb);
```

`owns(itemId)` and `quantityOf(itemId)` read the loaded inventory; they are
synchronous and cheap.

## Testing an item

- Desktop Play runs the store on Test Silicon: fake money tagged TEST; the
  panel's "Get Test Silicon" asks the store host for more. Real or Test
  Silicon is always the host's choice, never the game's. An item has one
  price: desktop Play charges it in Test Silicon, the Play page in real
  Silicon. Publishing and taking down do not change it.
- Desktop Play buys drafts and published items alike (Q48): every priced
  item shows Buy with its Test Silicon price; a free item is claimed as
  usual. Until the website's desktop Play update reaches
  that environment, a published item is refused and the store says
  "Published items can't be bought with Test Silicon here yet. Test the item as a draft for now." A published item whose Test Silicon price
  is not there yet says "This item can't be bought with Test Silicon yet.
  Try again in a minute."
- Only the game's owner can test the store in desktop Play; anyone else
  signed in to the desktop app sees "Only this game's owner can test its
  store in desktop Play." Desktop Play uses the game the project was linked
  to when Play started: after linking, Restart Play.
- Test purchases never count in sales statistics (recorded with currency
  test-coins). A permanent item bought in desktop Play stays owned, on the
  Play page too.
- Permanent items can be bought once per account; test repeated purchases
  with a consumable.
- To test what players see, publish the game as a draft and open its Play
  page (`/play/<gameId>`), signing in there: drafts are absent, live items
  are buyable with real Silicon after the Play page's confirmation.
- The panel footer shows `test silicon` when the host plays with Test
  Silicon, and `no store host` on a page without one (a local folder,
  `pnpm dev`), where the store shows "Store unavailable here". Games never
  sell Silicon; Get Silicon asks the host.

## Images

An https URL, or a file uploaded through the Store Manager into the game's
assets (`games/<gameId>/store/` on the CDN). The tile is 4:3 (for example
800x600) and crops the image to fill it, so keep the subject in the middle.
Without an image the tile shows placeholder art by kind.
