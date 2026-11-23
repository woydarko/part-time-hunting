import * as ENGINE from '@gnsx/genesys.js';

import { CHECK_ICON_SVG, CLOCK_ICON_SVG, formatCoins } from './store-icons.js';

/**
 * Purchase feedback on top of the kit Achievement toast (top-right slide-in).
 * The store-toast class moves it below the Play page's controls on phones (store-panel.css).
 */
export class PurchaseToast {
  private achievement: ENGINE.Achievement | null = null;

  public async initialize(uiManager: ENGINE.UIManager): Promise<void> {
    this.achievement = new ENGINE.Achievement(uiManager, { position: 'top-right', visible: false, customClasses: ['store-toast'] });
    await this.achievement.initialize();
  }

  /** `test`: the host charged Test Silicon. */
  public showPurchased(itemName: string, coins: number | null, test = false): void {
    this.show(
      `${itemName} is yours`,
      coins === null ? 'Added to your inventory for this game.' : `−${formatCoins(coins)} ${test ? 'Test Silicon' : 'Silicon'} · added to your inventory.`,
    );
  }

  /** The purchase is still being processed: no charge confirmation yet, and no need to buy again. A clock, not the check. */
  public showProcessing(itemName: string): void {
    this.show('Purchase processing', `${itemName} appears in your inventory once it goes through.`, CLOCK_ICON_SVG);
  }

  public showClaimed(itemName: string): void {
    this.show(`${itemName} claimed`, 'Added to your inventory for this game.');
  }

  public showConsumed(itemName: string, remaining: number): void {
    this.show(`${itemName} used`, remaining > 0 ? `${remaining} left.` : 'That was the last one.');
  }

  private show(title: string, description: string, iconHtml = CHECK_ICON_SVG): void {
    this.achievement?.show({ title, description, iconHtml, rarity: 'rare', duration: 4000 });
  }

  public destroy(): void {
    this.achievement?.destroy();
    this.achievement = null;
  }
}
