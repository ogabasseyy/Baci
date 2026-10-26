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

test('consent remains available above an already-open conversation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/chat-launcher');
  await page.getByRole('button', { name: 'Open AI chat assistant' }).click();
  await expect(page.locator('.ogabassey-chat-window')).toBeVisible();

  await page
    .getByRole('button', { name: 'Show consent' })
    .evaluate((button) => {
      (button as HTMLButtonElement).click();
    });

  await expect(
    page.getByRole('dialog', { name: 'Cookie consent' })
  ).toBeVisible();
  await expect(page.locator('.ogabassey-chat-window')).toBeVisible();
});

test('unrelated keyboard focus leaves a timed newsletter visible and interactive', async ({
  page,
}) => {
  await page.setContent(`
    <style>
      ${overlayCss}
      ${chatCss}
      .ogabassey-offer-popup { position: fixed; inset: 0; z-index: 80; }
    </style>
    <main>
      <button id="page-control">Page control</button>
      <div class="ogabassey-chat-anchor">
        <button class="ogabassey-chat-button">Assistant</button>
      </div>
    </main>
  `);

  await page.keyboard.press('Tab');
  const pageControl = page.locator('#page-control');
  await expect(pageControl).toBeFocused();
  await page.evaluate(() => {
    const popup = document.createElement('div');
    popup.className = 'ogabassey-newsletter-popup';
    popup.innerHTML = `
      <button type="button" tabindex="-1" aria-label="Dismiss newsletter popup backdrop">Backdrop</button>
      <button type="button" aria-label="Close newsletter">Close newsletter</button>
    `;
    popup
      .querySelector('button[aria-label="Close newsletter"]')
      ?.addEventListener('click', () => popup.remove());
    document.body.append(popup);
  });
  const popup = page.locator('.ogabassey-newsletter-popup');
  const close = page.getByRole('button', { name: 'Close newsletter' });
  await expect(popup).toHaveCSS('opacity', '1');

  await page.keyboard.press('Tab');
  await close.click();
  await expect(popup).toBeHidden();
  await expect(page.locator('.ogabassey-chat-button')).toBeVisible();
});
