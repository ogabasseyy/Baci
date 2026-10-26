import { expect, test } from '@playwright/test';

test('a dragged launcher and timed offer never occupy the same corner', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/chat-launcher');
  const enablePromotions = page.getByRole('button', {
    name: 'Enable timed promotions',
  });
  await enablePromotions.click();
  await enablePromotions.click();
  await page.getByRole('button', { name: 'Close newsletter' }).click({
    timeout: 8000,
  });

  const offer = page.locator('.ogabassey-offer-popup');
  await expect(offer).toBeVisible({ timeout: 15_000 });
  const launcher = page.getByRole('button', { name: 'Open AI chat assistant' });
  const launcherBox = await launcher.boundingBox();
  const offerBox = await offer.boundingBox();
  if (!launcherBox || !offerBox)
    throw new Error('Overlay controls are missing');
  const destination = { x: offerBox.x + 12, y: offerBox.y + 12 };
  await page.mouse.move(launcherBox.x + 28, launcherBox.y + 28);
  await page.mouse.down();
  await page.mouse.move(
    destination.x + 28 - launcherBox.x + launcherBox.x,
    destination.y + 28 - launcherBox.y + launcherBox.y,
    { steps: 12 }
  );
  await page.mouse.up();
  await page.getByRole('button', { name: 'Focus origin' }).focus();

  const anchor = page.locator('.ogabassey-chat-anchor');
  await expect(anchor).toHaveAttribute(
    'data-chat-launcher-offer-collision',
    ''
  );
  await expect(offer).toBeHidden();

  const movedBox = await launcher.boundingBox();
  if (!movedBox) throw new Error('Chat launcher lost its layout box');
  await page.mouse.move(movedBox.x + 28, movedBox.y + 28);
  await page.mouse.down();
  await page.mouse.move(1328, 828, { steps: 12 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Focus origin' }).focus();

  await expect(anchor).not.toHaveAttribute(
    'data-chat-launcher-offer-collision'
  );
  await expect(offer).toBeVisible();
});
