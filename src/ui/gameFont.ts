/**
 * gameFont - installs the custom "Trimen" UI font and forces it on every game-UI element.
 *
 * A stylesheet rule with !important beats the inline `font:` shorthands the widgets set (inline
 * styles aren't !important), so all HUD/menu text switches to Trimen without editing each component.
 * The @font-face URL is an @project asset path resolved to a served URL via resolveAssetPathsInText.
 */

import * as ENGINE from '@gnsx/genesys.js';

const FONT_URL = '@project/assets/fonts/hellobaby.otf';
let installed = false;

/** Inject the @font-face + override once, and tag the game container so its subtree uses the font. */
export async function installGameFont(container: HTMLElement): Promise<void> {
  container.classList.add('trimen-font');
  if (installed) return;
  installed = true;
  const css = `@font-face{font-family:'HelloBaby';font-display:swap;src:url('${FONT_URL}') format('opentype');}`
    + `.trimen-font, .trimen-font *{font-family:'HelloBaby', system-ui, sans-serif !important;}`;
  const resolved = await ENGINE.resolveAssetPathsInText(css);
  const style = document.createElement('style');
  style.textContent = resolved;
  document.head.appendChild(style);
}
