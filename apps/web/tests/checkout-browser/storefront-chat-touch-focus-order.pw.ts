import { expect, test } from '@playwright/test';

test('focus arriving between pointerup and click does not open chat after drag', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/chat-launcher');
  const launcher = page.getByRole('button', {
    name: 'Open AI chat assistant',
  });
  const bounds = await launcher.boundingBox();
  if (!bounds) throw new Error('Chat launcher is missing its layout box');

  await launcher.evaluate((button) => {
    button.addEventListener('pointerdown', () => button.blur(), { once: true });
    button.addEventListener(
      'pointerup',
      () => queueMicrotask(() => button.focus()),
      { once: true }
    );
  });

  const start = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 48, start.y + 48);
  await page.mouse.up();

  await expect(launcher).toBeFocused();
  await expect(page.locator('.ogabassey-chat-window')).toHaveCount(0);
});
