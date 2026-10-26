import { expect, test } from '@playwright/test';

test('newsletter appearing during touch drag waits until the gesture ends', async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.use.browserName !== 'chromium');
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 375, height: 800 },
  });
  const page = await context.newPage();
  const baseURL = testInfo.project.use.baseURL as string;
  await page.goto(new URL('/chat-launcher', baseURL).toString());
  const enablePromotions = page.getByRole('button', {
    name: 'Enable timed promotions',
  });
  await enablePromotions.click();
  await enablePromotions.click();
  const bounds = await page
    .getByRole('button', { name: 'Open AI chat assistant' })
    .boundingBox();
  if (!bounds) throw new Error('Chat launcher is missing its layout box');
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ id: 1, x: bounds.x + 24, y: bounds.y + 24 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ id: 1, x: bounds.x + 70, y: bounds.y + 65 }],
  });
  await expect(page.locator('.ogabassey-newsletter-popup')).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator('.ogabassey-chat-anchor')).toBeVisible();
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ id: 1, x: bounds.x + 115, y: bounds.y + 105 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await expect(page.locator('.ogabassey-chat-anchor')).toHaveCSS(
    'opacity',
    '0'
  );
  await expect(page.locator('.ogabassey-chat-anchor')).toHaveCSS(
    'pointer-events',
    'none'
  );
  await page.getByRole('button', { name: 'Close newsletter' }).click();
  await expect(page.locator('.ogabassey-chat-anchor')).toBeVisible();
  expect(
    await page
      .locator('.ogabassey-chat-anchor')
      .evaluate((anchor) => (anchor as HTMLElement).style.transform)
  ).toContain('translate3d(');
  await context.close();
});
