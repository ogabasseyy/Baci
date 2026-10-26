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

test('timed promotion stays hidden after keyboard focus leaves the launcher', async ({
  page,
}) => {
  await page.setContent(`
    <style>
      ${overlayCss}
      ${chatCss}
      .ogabassey-offer-popup { position: fixed; inset: 0; z-index: 80; }
    </style>
    <main>
      <div class="ogabassey-chat-anchor">
        <button class="ogabassey-chat-button">Assistant</button>
      </div>
      <button id="page-control">Page control</button>
    </main>
    <div class="ogabassey-offer-popup"><button>Close offer</button></div>
  `);

  const offer = page.locator('.ogabassey-offer-popup');
  await expect(offer).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.locator('.ogabassey-chat-button')).toBeFocused();
  await expect(offer).toBeHidden();
  await page.keyboard.press('Tab');
  await expect(page.locator('#page-control')).toBeFocused();
  await expect(offer).toBeHidden();
});
