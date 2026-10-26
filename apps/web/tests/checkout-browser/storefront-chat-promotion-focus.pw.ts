import { expect, test } from '@playwright/test';

test('timed newsletter yields to page focus after keyboard leaves the launcher', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/chat-launcher');
  const enablePromotions = page.getByRole('button', {
    name: 'Enable timed promotions',
  });
  await enablePromotions.click();
  await enablePromotions.click();

  const origin = page.getByRole('button', { name: 'Focus origin' });
  await origin.click();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const launcher = page.getByRole('button', { name: 'Open AI chat assistant' });
  await expect(launcher).toBeFocused();

  const newsletter = page.locator('.ogabassey-newsletter-popup');
  await expect(newsletter).toBeAttached({ timeout: 6000 });
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Page control after assistant' })
  ).toBeFocused();
  await expect(newsletter).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute(
    'data-chat-promotion-focus-handoff',
    'true'
  );
  await expect(newsletter).toHaveCSS('opacity', '0');
  await expect(launcher).toBeVisible();

  const beforeDrag = await launcher.boundingBox();
  if (!beforeDrag) throw new Error('Chat launcher has no layout box');
  await page.mouse.move(beforeDrag.x + 28, beforeDrag.y + 28);
  await page.mouse.down();
  await page.mouse.move(beforeDrag.x - 30, beforeDrag.y - 30, { steps: 5 });
  await page.mouse.up();
  const afterDrag = await launcher.boundingBox();
  if (!afterDrag) throw new Error('Chat launcher lost its layout box');
  expect(afterDrag.x).toBeLessThan(beforeDrag.x - 20);
  await expect(page.locator('body')).toHaveAttribute(
    'data-chat-promotion-focus-handoff',
    'true'
  );
  await page
    .getByRole('button', { name: 'Page control after assistant' })
    .focus();

  const close = page.getByRole('button', { name: 'Close newsletter' });
  await page.keyboard.press('Shift+Tab');
  await expect(launcher).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(
    page.getByRole('button', { name: 'Show newsletter' })
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await expect(newsletter).toHaveCSS('opacity', '1');
  await page.keyboard.press('Enter');
  await expect(newsletter).toBeHidden();
  await expect(launcher).toBeVisible();
  await expect(launcher).toBeFocused();
});

test('pointer dismissal does not redirect focus to the launcher', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/chat-launcher');
  await page.getByRole('button', { name: 'Enable timed promotions' }).click();
  await page.getByRole('button', { name: 'Enable timed promotions' }).click();

  const close = page.getByRole('button', { name: 'Close newsletter' });
  await expect(close).toBeAttached({ timeout: 6000 });
  await close.click();

  await expect(page.locator('.ogabassey-newsletter-popup')).toBeHidden();
  await expect(
    page.getByRole('button', { name: 'Open AI chat assistant' })
  ).not.toBeFocused();
});

test('unrelated keyboard focus does not hide or disable a timed newsletter', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/chat-launcher');
  await page.getByRole('button', { name: 'Enable timed promotions' }).click();
  const origin = page.getByRole('button', { name: 'Focus origin' });
  await origin.click();

  const newsletter = page.locator('.ogabassey-newsletter-popup');
  await expect(newsletter).toBeAttached({ timeout: 6000 });
  await expect(newsletter).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Enable timed promotions' })
  ).toBeFocused();
  await expect(newsletter).toBeVisible();
  await expect(newsletter).toHaveCSS('opacity', '1');
  await expect(newsletter).toHaveCSS('pointer-events', 'auto');
});

test('promotion focus handoff survives loading and closing chat', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/chat-launcher');
  await page.getByRole('button', { name: 'Enable timed promotions' }).click();

  const launcher = page.locator(
    '.ogabassey-chat-anchor .ogabassey-chat-button'
  );
  await launcher.click();
  await expect(page.locator('.ogabassey-chat-window')).toBeVisible();
  await page.getByRole('button', { name: 'Close chat' }).click();
  await expect(page.locator('.ogabassey-chat-window')).toBeHidden();

  const newsletter = page.locator('.ogabassey-newsletter-popup');
  await expect(newsletter).toBeAttached({ timeout: 6000 });
  await launcher.focus();
  await page.keyboard.press('Tab');

  await expect(
    page.getByRole('button', { name: 'Page control after assistant' })
  ).toBeFocused();
  await expect(page.locator('body')).toHaveAttribute(
    'data-chat-promotion-focus-handoff',
    'true'
  );
  await expect(newsletter).toHaveCSS('opacity', '0');
});
