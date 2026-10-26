import { expect, test } from '@playwright/test';

test('mobile launcher advertises keyboard movement without snapping upward', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/chat-launcher');
  await page.getByRole('button', { name: 'Show mobile footer' }).click();

  const launcher = page.getByRole('button', { name: 'Assistant launcher' });
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

test('real drag hook clamps, suppresses drag click, and hands position to chat', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/chat-launcher');
    const launcher = page.getByRole('button', { name: 'Assistant launcher' });
    const initialBounds = await launcher.boundingBox();
    if (!initialBounds)
      throw new Error('Chat launcher is missing its layout box');
    await page.mouse.move(
      initialBounds.x + initialBounds.width / 2,
      initialBounds.y + initialBounds.height / 2
    );
    await expect
      .poll(async () => (await launcher.boundingBox())?.width ?? 0)
      .toBeGreaterThan(initialBounds.width + 1);
    const bounds = await launcher.boundingBox();
    if (!bounds) throw new Error('Chat launcher lost its layout box');
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
    await page.mouse.move(width < 768 ? width - 1 : 1, width < 768 ? 799 : 1, {
      steps: 5,
    });
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
      .getByTestId('deferred-launcher')
      .evaluate((anchor) => (anchor as HTMLElement).style.transform);
    expect(dragPosition).toContain('translate3d(');
    const dragBounds = await launcher.boundingBox();
    if (!dragBounds) throw new Error('Chat launcher lost its layout box');
    // The CSS hover scale can extend the painted edge slightly beyond the
    // pre-scale box used for pointer clamping; assert it stays safely in view.
    expect(dragBounds.x).toBeGreaterThanOrEqual(12);
    expect(dragBounds.y).toBeGreaterThanOrEqual(12);
    expect(dragBounds.x + dragBounds.width).toBeLessThanOrEqual(width - 12);
    expect(dragBounds.y + dragBounds.height).toBeLessThanOrEqual(800 - 28);
    await expect(page.getByTestId('deferred-launcher')).toBeVisible();

    await launcher.click();
    await expect(page.getByTestId('runtime-launcher')).toBeVisible();
    await expect(page.getByTestId('chat-window')).toBeVisible();
    await page.getByRole('button', { name: 'Close chat' }).click();
    const restoredPosition = await page
      .getByTestId('runtime-launcher')
      .evaluate((anchor) => (anchor as HTMLElement).style.transform);
    expect(restoredPosition).toBe(dragPosition);

    if (width < 768) {
      await page.getByRole('button', { name: 'Show mobile footer' }).click();
      const offset = await page
        .getByTestId('runtime-launcher')
        .evaluate((anchor) =>
          Number.parseFloat(getComputedStyle(anchor, '::after').height)
        );
      expect(offset).toBe(92);
      const footerClamped = await launcher.boundingBox();
      if (!footerClamped)
        throw new Error('Chat launcher was hidden by the footer');
      expect(footerClamped.y + footerClamped.height).toBeLessThanOrEqual(
        800 - 92 - 15
      );
    }

    if (width === 375) {
      await page.evaluate(() => localStorage.clear());
      await page.goto('/chat-launcher');
      await page.waitForTimeout(100);
      await page.getByRole('button', { name: 'Show mobile footer' }).click();
      await page.waitForTimeout(4100);
      await expect(page.locator('.ogabassey-newsletter-popup')).toBeVisible();
      await page.getByRole('button', { name: 'Close newsletter' }).click();
      await page.waitForTimeout(10100);
      await expect(page.locator('.ogabassey-offer-popup')).toBeVisible();
      await expect(page.getByTestId('deferred-launcher')).toBeHidden();
      await expect(
        page.locator('button[aria-label="Assistant launcher"]')
      ).not.toBeFocused();
      await page.getByRole('button', { name: 'Close ad' }).focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('.ogabassey-offer-popup')).toBeHidden();
      await expect(page.getByTestId('deferred-launcher')).toBeVisible();
      await page.getByRole('button', { name: 'Assistant launcher' }).focus();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('chat-window')).toBeVisible();
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
    .getByRole('button', { name: 'Assistant launcher' })
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

  await expect(page.getByTestId('deferred-launcher')).toBeVisible();
  expect(
    await page
      .getByTestId('deferred-launcher')
      .evaluate((anchor) => (anchor as HTMLElement).style.transform)
  ).toBe('translate3d(16px, 16px, 0px)');
  await expect(page.getByTestId('runtime-launcher')).toHaveCount(0);
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
  const bounds = await page
    .getByRole('button', { name: 'Assistant launcher' })
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
  await page.waitForTimeout(4100);
  await expect(page.locator('.ogabassey-newsletter-popup')).toBeVisible();
  await expect(page.getByTestId('deferred-launcher')).toBeVisible();
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ id: 1, x: bounds.x + 115, y: bounds.y + 105 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await expect(page.getByTestId('deferred-launcher')).toBeHidden();
  await page.getByRole('button', { name: 'Close newsletter' }).click();
  await expect(page.getByTestId('deferred-launcher')).toBeVisible();
  expect(
    await page
      .getByTestId('deferred-launcher')
      .evaluate((anchor) => (anchor as HTMLElement).style.transform)
  ).toContain('translate3d(');
  await context.close();
});
