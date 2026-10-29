import { expect, test } from '@playwright/test';

test('a dragged launcher and timed offer never occupy the same corner', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/chat-launcher');
  // The harness omits Tailwind utilities; model the production bottom-left offer box.
  await page.addStyleTag({
    content:
      '.ogabassey-offer-popup { position: fixed !important; left: 0 !important; bottom: 0 !important; width: 350px !important; height: 240px !important; }',
  });
  const enablePromotions = page.getByRole('button', {
    name: 'Enable timed promotions',
  });
  await enablePromotions.click();
  await enablePromotions.click();
  await page.getByRole('button', { name: 'Close newsletter' }).click({
    timeout: 8000,
  });

  const launcher = page.getByRole('button', { name: 'Open AI chat assistant' });
  const initialBox = await launcher.boundingBox();
  if (!initialBox) throw new Error('Chat launcher is missing its layout box');
  await page.mouse.move(initialBox.x + 28, initialBox.y + 28);
  await page.mouse.down();
  await page.mouse.move(52, 748, { steps: 12 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Focus origin' }).focus();

  const offer = page.locator('.ogabassey-offer-popup');
  const anchor = page.locator('.ogabassey-chat-anchor');
  await expect(offer).toBeAttached({ timeout: 15_000 });
  await page.waitForTimeout(750);
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
