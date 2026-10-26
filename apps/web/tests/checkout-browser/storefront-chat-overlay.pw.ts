import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const coreCss = readFileSync(
  'src/app/(storefront)/storefront-core.css',
  'utf8'
);
const chatCss = readFileSync(
  'src/app/(storefront)/storefront-chat.css',
  'utf8'
);
const overlayCss = coreCss.slice(
  coreCss.indexOf(
    '/* Consent takes priority over promotional and assistant chrome.'
  )
);

test('focused launcher remains reachable and pauses promotional overlays', async ({
  page,
}) => {
  await page.setContent(`
    <style>${overlayCss}\n${chatCss}</style>
    <div class="ogabassey-chat-anchor" data-mobile-offset="default">
      <button id="launcher" class="ogabassey-chat-button">Open assistant</button>
    </div>
  `);
  await page.evaluate(() => {
    const browserWindow = window as typeof window & {
      activationCount?: number;
    };
    browserWindow.activationCount = 0;
    document.querySelector('#launcher')?.addEventListener('click', () => {
      browserWindow.activationCount = (browserWindow.activationCount ?? 0) + 1;
    });
  });

  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    const offset = await page
      .locator('.ogabassey-chat-anchor')
      .evaluate((anchor) => getComputedStyle(anchor, '::after').height);
    expect(offset).toBe(width < 768 ? '92px' : '0px');

    await page.locator('#launcher').focus();
    await page.evaluate(() => {
      document.body.insertAdjacentHTML(
        'beforeend',
        '<div class="ogabassey-offer-popup">Offer</div><div class="ogabassey-newsletter-popup">Newsletter</div>'
      );
      (window as typeof window & { activationCount?: number }).activationCount =
        0;
    });

    await expect(page.locator('#launcher')).toBeFocused();
    await expect(page.locator('.ogabassey-chat-anchor')).toBeVisible();
    await expect(page.locator('.ogabassey-offer-popup')).toBeHidden();
    await expect(page.locator('.ogabassey-newsletter-popup')).toBeHidden();
    await page.keyboard.press('Enter');
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { activationCount?: number })
            .activationCount
      )
    ).toBe(1);

    await page
      .locator('#launcher')
      .evaluate((button) => (button as HTMLElement).blur());
    await expect(page.locator('.ogabassey-offer-popup')).toBeVisible();
    await expect(page.locator('.ogabassey-newsletter-popup')).toBeVisible();
    await page
      .locator('.ogabassey-offer-popup')
      .evaluate((popup) => popup.remove());
    await page
      .locator('.ogabassey-newsletter-popup')
      .evaluate((popup) => popup.remove());
  }
});
