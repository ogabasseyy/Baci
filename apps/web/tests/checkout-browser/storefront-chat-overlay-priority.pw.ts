import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const overlayCss = readFileSync(
  'src/app/(storefront)/storefront-chat-overlay-priority.css',
  'utf8'
);
const chatCss = readFileSync(
  'src/app/(storefront)/storefront-chat.css',
  'utf8'
);

test('mobile launcher advertises keyboard movement without snapping upward', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/chat-launcher');

  const launcher = page.getByRole('button', { name: 'Open AI chat assistant' });
  await expect(launcher).toHaveAttribute(
    'aria-keyshortcuts',
    'ArrowUp ArrowDown ArrowLeft ArrowRight'
  );
  const initialBounds = await launcher.boundingBox();
  if (!initialBounds)
    throw new Error('Chat launcher is missing its layout box');

  await launcher.focus();
  await page.keyboard.press('ArrowDown');

  const movedBounds = await launcher.boundingBox();
  if (!movedBounds) throw new Error('Chat launcher lost its layout box');
  expect(movedBounds.y).toBe(initialBounds.y);
});

test('focused launcher remains reachable and pauses promotional overlays', async ({
  page,
}) => {
  await page.setContent(`
    <meta name="viewport" content="width=device-width, initial-scale=1" />
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
    if (width >= 768) {
      await expect
        .poll(() =>
          page
            .locator('.ogabassey-chat-anchor')
            .evaluate((anchor) => getComputedStyle(anchor).bottom)
        )
        .toBe('16px');
    }

    await page.evaluate(() => {
      document.body.insertAdjacentHTML(
        'beforeend',
        '<div class="ogabassey-offer-popup">Offer</div>'
      );
    });
    expect(await page.locator('.ogabassey-chat-anchor').isVisible()).toBe(
      width >= 424
    );
    await page
      .locator('.ogabassey-offer-popup')
      .evaluate((popup) => popup.remove());
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

test('an open conversation stays above the non-modal consent banner', async ({
  page,
}) => {
  await page.setContent(`
    <style>${overlayCss}\n${chatCss}</style>
    <div class="ogabassey-chat-anchor">
      <section class="ogabassey-chat-window">Active conversation</section>
      <button class="ogabassey-chat-button">Assistant</button>
    </div>
    <div class="storefront-cookie-consent" role="dialog" aria-modal="false">
      Cookie preferences
    </div>
  `);

  await expect(page.locator('.ogabassey-chat-window')).toBeVisible();
  await expect(page.locator('.storefront-cookie-consent')).toBeHidden();
});
