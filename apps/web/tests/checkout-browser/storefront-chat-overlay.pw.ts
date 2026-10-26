import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const coreCss = readFileSync(
  'src/app/(storefront)/storefront-core.css',
  'utf8'
);
const chatCss = readFileSync(
  'src/app/(storefront)/storefront-chat.css',
  'utf8'
);
const overlayCss = coreCss.slice(
  coreCss.indexOf(
    '/* Consent takes priority over promotional and assistant chrome.'
  )
);

test('focused launcher remains reachable and pauses promotional overlays', async ({
  page,
}) => {
  await page.setContent(`
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>${overlayCss}\n${chatCss}</style>
    <div class="ogabassey-chat-anchor" data-mobile-offset="default">
      <button id="launcher" class="ogabassey-chat-button">Open assistant</button>
    </div>
  `);
  await page.evaluate(() => {
    const browserWindow = window as typeof window & {
      activationCount?: number;
    };
    browserWindow.activationCount = 0;
    document.querySelector('#launcher')?.addEventListener('click', () => {
      browserWindow.activationCount = (browserWindow.activationCount ?? 0) + 1;
    });
  });

  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    const offset = await page
      .locator('.ogabassey-chat-anchor')
      .evaluate((anchor) => getComputedStyle(anchor, '::after').height);
    expect(offset).toBe(width < 768 ? '92px' : '0px');

    await page.evaluate(() => {
      document.body.insertAdjacentHTML(
        'beforeend',
        '<div class="ogabassey-offer-popup">Offer</div>'
      );
    });
    expect(await page.locator('.ogabassey-chat-anchor').isVisible()).toBe(
      width >= 424
    );
    await page
      .locator('.ogabassey-offer-popup')
      .evaluate((popup) => popup.remove());
    await page.locator('#launcher').focus();
    await page.evaluate(() => {
      document.body.insertAdjacentHTML(
        'beforeend',
        '<div class="ogabassey-offer-popup">Offer</div><div class="ogabassey-newsletter-popup">Newsletter</div>'
      );
      (window as typeof window & { activationCount?: number }).activationCount =
        0;
    });

    await expect(page.locator('#launcher')).toBeFocused();
    await expect(page.locator('.ogabassey-chat-anchor')).toBeVisible();
    await expect(page.locator('.ogabassey-offer-popup')).toBeHidden();
    await expect(page.locator('.ogabassey-newsletter-popup')).toBeHidden();
    await page.keyboard.press('Enter');
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { activationCount?: number })
            .activationCount
      )
    ).toBe(1);

    await page
      .locator('#launcher')
      .evaluate((button) => (button as HTMLElement).blur());
    await expect(page.locator('.ogabassey-offer-popup')).toBeVisible();
    await expect(page.locator('.ogabassey-newsletter-popup')).toBeVisible();
    await page
      .locator('.ogabassey-offer-popup')
      .evaluate((popup) => popup.remove());
    await page
      .locator('.ogabassey-newsletter-popup')
      .evaluate((popup) => popup.remove());
  }
});

test('real drag hook clamps, suppresses drag click, and hands position to chat', async ({
  page,
}) => {
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
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(width < 768 ? width - 1 : 1, width < 768 ? 799 : 1, {
      steps: 5,
    });
    await page.mouse.up();

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
