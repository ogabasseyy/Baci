import { expect, test } from '@playwright/test';

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
