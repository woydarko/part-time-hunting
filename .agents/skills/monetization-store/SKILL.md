---
name: monetization-store
description: Use when a Genesys game should sell items to players — an in-game store, shop, Silicon (formerly Coins), buying, top-up, Get Silicon, inventory of bought items, permanent or consumable items — or when an existing store shows guest, unlinked, unavailable, insufficient Silicon, or top-up problems. Games never sell Silicon themselves; the Play page opens Get Silicon. Entry point; `monetization-store-components` holds the code, `monetization-store-items` covers creating and testing items.
metadata:
  tokens: 1577
---

# Monetization Store

An in-game store for Sandbox games. Players buy the creator's items with
Silicon (the Play page confirms each purchase), top up Silicon through Get
Silicon, and see what they own. The UI is built from the engine's UI kit widgets, so it matches
the rest of the game and can be re-skinned.

## How it works

- The store talks only to the page's store host, `window.genesysPlayStore`.
  On the Play page (`/play/<gameId>`) the game runs in its own frame and the
  page around it answers: it signs the player in, confirms every priced
  purchase on its own panel, opens Get Silicon, and decides real Silicon or
  Test Silicon. Behind it, core (tsb-core-api) owns the game's items and
  each player's inventory, and the store API keeps the Silicon balance. The
  game never handles tokens, addresses, environments or payment modes, and
  the template holds no address at all.
- Players sign in on the host (on the Play page, a Sandbox account popup);
  nobody signs in inside the game. A player who is not signed in can browse;
  buying, claiming, the balance and the inventory need sign-in.
- Where the page has no store host (a local folder, `pnpm dev`) the store
  shows "Store unavailable here" and calls nothing.
- Silicon is one shared balance across all Sandbox games. It is the premium
  currency formerly called Coins; the API still names it `coins` (SKU, price
  and balance fields), only the display name changed.
- A game never sells Silicon. Get Silicon asks the host, which opens the
  Sandbox top-up page; the store re-reads the balance when the host reports
  a change and when the player comes back to the game tab.
- Items belong to one game and carry their creator; core derives both. The
  game names items by their item id (core's id, shown in the Store Manager).
- New items are drafts until published. Players never see drafts.
- Real or Test Silicon is the host's choice, never the game's. With Test
  Silicon the panel tags the balance TEST and its button reads "Get Test
  Silicon".

## Adding the store to a game

1. Link the project to a game: run
   `genesys.actionStore({ action: 'linkGame' })` through the editor's MCP
   (`monetization-store-items`). It registers the game under the creator's
   Studio login and writes `gameId` into `<project>.genesys-project`, as
   opening Store Manager does; when the project is already linked it returns
   the existing id. No approval is needed. When the result has
   `gameCreated: true`, tell the creator the game was registered and give
   the id. Errors name the fix (`store_not_signed_in`, `no_project_open`,
   `store_disabled`, `store_link_failed`); pass it on and retry.
2. Run the install script from the project root:
   `node .agents/skills/monetization-store-components/scripts/install-store.mjs`.
   It copies `src/store/` and `assets/ui/store/` from
   `monetization-store-components/templates`, writes the `gameId` into
   `src/store/store-config.ts`, and checks the engine has the widgets the
   store uses. Rerun it later to update the templates; it keeps
   `store-config.ts`.
3. In the game mode (`src/game.ts`, the class extending `ENGINE.GameMode`),
   install in `beginPlay` and destroy in `endPlay` — snippet in
   `monetization-store-components/references/components.md`.
4. Create the items through the editor's MCP store tools
   (`monetization-store-items`). The creator can review and edit them later
   in the editor's Store Manager (main menu).
5. React to purchases where the gameplay effect belongs:
   `store.controller.on('purchased' | 'claimed' | 'consumed', ({ itemId }) => …)`
   and `store.controller.owns(itemId)` when a level loads. Item ids come from
   the Store Manager or `listItems`; keep them in one `src/store-items.ts` as
   named constants.
6. `pnpm build` and `pnpm lint`, then play: the `B` key or the HUD chip opens
   the store. Desktop Play runs it on Test Silicon, the Play page on real
   Silicon.

Ask the creator only what the templates cannot decide, before writing code:
what the store should sell and what each item does in the game, the hotkey
(default `B`) and an accent color (default: the kit's blue). One short
message with the open points; everything else has a working default. Item
details (type, price, image, draft or publish) follow the questions in
`monetization-store-items`.

## Rules

- Do not modify `src/store/` on install. Customize afterwards through
  `store-config.ts` and `monetization-store-components/references/customization.md`.
- Never add token, cookie or sign-in handling, never read the game id from
  the URL, never add an address or call an API from the game: the store host
  does all of that. The template holds no address.
- Never sell Silicon inside a game: no Silicon packs, no Pay Station, no calls
  to `/api/payment/packages`. Those routes belong to the Sandbox top-up page.
  If a creator asks for an in-game top-up, explain that Get Silicon already
  sends players to the Sandbox page, and do not build one.
- The game adds no confirmation dialog: the host confirms every priced
  purchase on its own panel. Insufficient Silicon shows "You need N more
  Silicon" with a Get Silicon button; do not add an error popup, and call
  Get Silicon only from a click.
- Never retry a purchase, in the store or in game code: there is no
  idempotency key, so a consumable would be charged twice. A pending one
  shows "Purchase processing" and settles by itself.
- Dynamic text goes through widget setters or `textContent`. `imageHtml`
  only receives markup from `safeImageHtml` or developer-authored SVG.
- Gameplay reacts to controller events and `owns(itemId)`; it never calls
  `window.genesysPlayStore` or any API directly.

## References

- `references/api.md` — the store host's contract and codes, and the core
  and store API endpoints behind it.
- `references/troubleshooting.md` — symptoms and causes.
- `monetization-store-components` — the code, options, events, customization.
- `monetization-store-items` — creating, pricing, publishing and testing items.
