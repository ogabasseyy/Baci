import { expect, test } from '@playwright/test';

test('real drag hook clamps, suppresses drag click, and hands position to chat', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/chat-launcher');
    const launcher = page.getByRole('button', {
      name: 'Open AI chat assistant',
    });
    const initialBounds = await launcher.boundingBox();
    if (!initialBounds)
      throw new Error('Chat launcher is missing its layout box');
    await page.mouse.move(
      initialBounds.x + initialBounds.width / 2,
      initialBounds.y + initialBounds.height / 2
    );
    await expect
      .poll(() =>
        launcher.evaluate((button) => getComputedStyle(button).filter)
      )
      .toBe('brightness(1.06)');
    const bounds = await launcher.boundingBox();
    if (!bounds) throw new Error('Chat launcher lost its layout box');
    expect(bounds.width).toBeCloseTo(initialBounds.width, 1);
    const start = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    };
    await launcher.evaluate((button) => {
      const state = window as typeof window & {
        lastLauncherPointerUpId?: number;
        lastLauncherClick?: {
          isPointerEvent: boolean;
          isTrusted: boolean;
          pointerId?: number;
        };
      };
      button.addEventListener('pointerup', (event) => {
        state.lastLauncherPointerUpId = (event as PointerEvent).pointerId;
      });
      button.addEventListener('click', (event) => {
        const click = event as PointerEvent;
        state.lastLauncherClick = {
          isPointerEvent: event instanceof PointerEvent,
          isTrusted: event.isTrusted,
          pointerId: click.pointerId,
        };
      });
    });
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(1, 1, { steps: 5 });
    await page.mouse.up();

    const browserClick = await page.evaluate(() => {
      const state = window as typeof window & {
        lastLauncherPointerUpId?: number;
        lastLauncherClick?: {
          isPointerEvent: boolean;
          isTrusted: boolean;
          pointerId?: number;
        };
      };
      return {
        pointerUpId: state.lastLauncherPointerUpId,
        click: state.lastLauncherClick,
      };
    });
    if (testInfo.project.use.browserName === 'webkit') {
      expect(browserClick.click?.isPointerEvent).toBe(true);
      expect(browserClick.click?.pointerId).toBe(browserClick.pointerUpId);
    }
    if (testInfo.project.use.browserName === 'firefox') {
      expect(browserClick.click?.isPointerEvent).toBe(true);
      expect(browserClick.click?.isTrusted).toBe(true);
    }

    const dragPosition = await page
      .locator('.ogabassey-chat-anchor')
      .evaluate((anchor) => (anchor as HTMLElement).style.transform);
    expect(dragPosition).toContain('translate3d(');
    const dragBounds = await launcher.boundingBox();
    if (!dragBounds) throw new Error('Chat launcher lost its layout box');
    expect(dragBounds.x).toBeGreaterThanOrEqual(12);
    expect(dragBounds.y).toBeGreaterThanOrEqual(12);
    expect(dragBounds.x + dragBounds.width).toBeLessThanOrEqual(width - 12);
    expect(dragBounds.y + dragBounds.height).toBeLessThanOrEqual(800 - 27);
    await expect(page.locator('.ogabassey-chat-anchor')).toBeVisible();
    await expect(launcher).toBeVisible();
    await expect(page.locator('.ogabassey-chat-window')).toHaveCount(0);

    await launcher.click();
    await expect(page.locator('.ogabassey-chat-window')).toBeVisible();
    await page.getByRole('button', { name: 'Close chat' }).click();
    await expect(page.locator('.ogabassey-chat-window')).toBeHidden();
    const toggle = page.getByRole('button', { name: 'Toggle chat' });
    const firstRestoredBounds = await toggle.boundingBox();
    if (!firstRestoredBounds)
      throw new Error('Chat launcher lost its layout box');
    expect(firstRestoredBounds.x).toBeLessThan(width / 2);
    expect(firstRestoredBounds.y).toBeLessThan(800 / 2);
    const toggleBounds = firstRestoredBounds;
    const toggleStart = {
      x: toggleBounds.x + toggleBounds.width / 2,
      y: toggleBounds.y + toggleBounds.height / 2,
    };
    const size = width >= 768 ? 80 : 56;
    const bottom = width >= 768 ? 16 : 108;
    const release = {
      x: width - 16 - size / 2,
      y: 800 - bottom - size / 2,
    };
    await page.mouse.move(toggleStart.x, toggleStart.y);
    await page.mouse.down();
    await page.mouse.move(release.x, release.y);
    await page.mouse.up();
    await expect(page.locator('.ogabassey-chat-window')).toHaveCount(0);
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.ogabassey-chat-window')).toBeVisible();
    const openToggleBounds = await toggle.boundingBox();
    if (!openToggleBounds) throw new Error('Chat launcher lost its layout box');
    expect(
      Math.abs(openToggleBounds.x + openToggleBounds.width / 2 - release.x)
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(openToggleBounds.y + openToggleBounds.height / 2 - release.y)
    ).toBeLessThanOrEqual(2);
    await page.mouse.click(release.x, release.y);
    await expect(page.locator('.ogabassey-chat-window')).toBeHidden();
    const restoredPosition = await page
      .locator('.ogabassey-chat-anchor')
      .evaluate((anchor) => (anchor as HTMLElement).style.transform);
    expect(restoredPosition).toContain('translate3d(');
    const restoredBounds = await page
      .getByRole('button', { name: 'Toggle chat' })
      .boundingBox();
    if (!restoredBounds) throw new Error('Chat launcher lost its layout box');
    expect(restoredBounds.x).toBeGreaterThan(width / 2);
    expect(restoredBounds.y).toBeGreaterThan(800 / 2);

    if (width < 768) {
      const offset = await page
        .locator('.ogabassey-chat-anchor')
        .evaluate((anchor) =>
          Number.parseFloat(getComputedStyle(anchor, '::after').height)
        );
      expect(offset).toBe(92);
      const footerClamped = await page
        .getByRole('button', { name: 'Toggle chat' })
        .boundingBox();
      if (!footerClamped)
        throw new Error('Chat launcher was hidden by the footer');
      expect(footerClamped.y + footerClamped.height).toBeLessThanOrEqual(
        800 - 92 - 15
      );
    }

    if (width === 375) {
      await page.evaluate(() => localStorage.clear());
      await page.goto('/chat-launcher');
      const enablePromotions = page.getByRole('button', {
        name: 'Enable timed promotions',
      });
      await enablePromotions.click();
      await enablePromotions.click();
      await expect(page.locator('.ogabassey-newsletter-popup')).toBeVisible({
        timeout: 15_000,
      });
      await page.getByRole('button', { name: 'Close newsletter' }).focus();
      await page.keyboard.press('Enter');
      await expect(
        page.getByRole('button', { name: 'Open AI chat assistant' })
      ).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(
        page.getByRole('button', { name: 'Open AI chat assistant' })
      ).not.toBeFocused();
      await expect(page.locator('.ogabassey-offer-popup')).toBeVisible({
        timeout: 15_000,
      });
      await page.getByRole('button', { name: 'Close ad' }).focus();
      await expect(page.locator('.ogabassey-chat-anchor')).toBeHidden();
      await expect(
        page.locator('button[aria-label="Open AI chat assistant"]')
      ).not.toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.locator('.ogabassey-offer-popup')).toBeHidden();
      await expect(page.locator('.ogabassey-chat-anchor')).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Open AI chat assistant' })
      ).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.locator('.ogabassey-chat-window')).toBeVisible();
    }
  }
});

test('touch drag emits a suppressed click without loading chat', async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.use.browserName !== 'chromium',
    'Touch input uses Chromium CDP'
  );
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 375, height: 800 },
  });
  const page = await context.newPage();
  const baseURL = testInfo.project.use.baseURL as string;
  await page.goto(new URL('/chat-launcher', baseURL).toString());
  const bounds = await page
    .getByRole('button', { name: 'Open AI chat assistant' })
    .boundingBox();
  if (!bounds) throw new Error('Chat launcher is missing its layout box');

  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      {
        id: 1,
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
      },
    ],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ id: 1, x: 1, y: 1 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });

  await expect(page.locator('.ogabassey-chat-anchor')).toBeVisible();
  expect(
    await page
      .locator('.ogabassey-chat-anchor')
      .evaluate((anchor) => (anchor as HTMLElement).style.transform)
  ).toBe('translate3d(16px, 16px, 0px)');
  await expect(page.locator('.ogabassey-chat-window')).toHaveCount(0);
  await context.close();
});

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
  await expect(page.locator('.ogabassey-chat-anchor')).toBeHidden();
  await page.getByRole('button', { name: 'Close newsletter' }).click();
  await expect(page.locator('.ogabassey-chat-anchor')).toBeVisible();
  expect(
    await page
      .locator('.ogabassey-chat-anchor')
      .evaluate((anchor) => (anchor as HTMLElement).style.transform)
  ).toContain('translate3d(');
  await context.close();
});
