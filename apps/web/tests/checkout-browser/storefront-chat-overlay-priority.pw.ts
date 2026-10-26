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

test('consent focus handoff works with storefront overlay CSS', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/chat-launcher');
  const launcher = page.getByRole('button', { name: 'Open AI chat assistant' });
  await expect(launcher).toBeVisible();
  await launcher.focus();

  await page
    .getByRole('button', { name: 'Show consent' })
    .evaluate((button) => (button as HTMLButtonElement).click());
  const dismiss = page.getByRole('button', { name: 'Dismiss consent' });
  await expect(launcher).toBeFocused();
  await expect(page.locator('.ogabassey-chat-anchor')).toBeVisible();
  await expect(page.locator('.ogabassey-chat-anchor')).toHaveCSS(
    'z-index',
    '101'
  );

  await dismiss.focus();
  await dismiss.click();
  await expect(launcher).toBeFocused();
  await expect(launcher).toBeVisible();
});

test('consent restores focus to the visible promotion when chat is suppressed', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/chat-launcher');
  const launcher = page.getByRole('button', { name: 'Open AI chat assistant' });
  await launcher.focus();
  await page
    .getByRole('button', { name: 'Show consent' })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await page
    .getByRole('button', { name: 'Show newsletter' })
    .evaluate((button) => (button as HTMLButtonElement).click());

  await page.getByRole('button', { name: 'Dismiss consent' }).click();

  await expect(page.locator('.ogabassey-chat-anchor')).toHaveCSS(
    'opacity',
    '0'
  );
  await expect(page.locator('.ogabassey-chat-anchor')).toHaveCSS(
    'pointer-events',
    'none'
  );
  await expect(
    page.getByRole('button', { name: 'Close newsletter' })
  ).toBeFocused();
});

test('consent dismissal restores the ordinary control focused before banner entry', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/chat-launcher');
  const origin = page.getByRole('button', { name: 'Focus origin' });
  await origin.focus();
  await page
    .getByRole('button', { name: 'Show consent' })
    .evaluate((button) => {
      (button as HTMLButtonElement).click();
    });
  await page.getByRole('button', { name: 'Consent details' }).focus();
  const dismiss = page.getByRole('button', { name: 'Dismiss consent' });
  await dismiss.focus();
  await expect(dismiss).toBeFocused();
  await dismiss.click();
  await expect(origin).toBeFocused();
});

test('consent dismissal preserves a newer outside focus after launcher handoff', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/chat-launcher');
  const launcher = page.getByRole('button', { name: 'Open AI chat assistant' });
  await launcher.focus();
  await page
    .getByRole('button', { name: 'Show consent' })
    .evaluate((button) => (button as HTMLButtonElement).click());

  const dismiss = page.getByRole('button', { name: 'Dismiss consent' });
  await expect(launcher).toBeFocused();
  const origin = page.getByRole('button', { name: 'Focus origin' });
  await origin.focus();
  await expect(origin).toBeFocused();

  await dismiss.click();
  await expect(origin).toBeFocused();
});

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
    if (width >= 768) {
      await expect
        .poll(() =>
          page
            .locator('.ogabassey-chat-anchor')
            .evaluate((anchor) => getComputedStyle(anchor).bottom)
        )
        .toBe('16px');
    }

    await page.evaluate(() => {
      document.body.insertAdjacentHTML(
        'beforeend',
        '<div class="ogabassey-offer-popup">Offer</div>'
      );
    });
    await expect(page.locator('.ogabassey-chat-anchor')).toHaveCSS(
      'opacity',
      width >= 424 ? '1' : '0'
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

test('consent remains visible alongside an open conversation', async ({
  page,
}) => {
  await page.setContent(`
    <style>${overlayCss}\n${chatCss}</style>
    <div class="ogabassey-chat-anchor">
      <section class="ogabassey-chat-window">Active conversation</section>
      <button class="ogabassey-chat-button">Assistant</button>
    </div>
    <div class="storefront-cookie-consent" role="dialog" aria-modal="false">
      Cookie preferences
    </div>
  `);

  await expect(page.locator('.ogabassey-chat-window')).toBeVisible();
  await expect(page.locator('.storefront-cookie-consent')).toBeVisible();

  await page
    .locator('.ogabassey-chat-window')
    .evaluate((window) => window.remove());
  await expect(page.locator('.storefront-cookie-consent')).toBeVisible();
});

test('dragged launcher stays inside a pinch-zoomed visual viewport', async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.use.browserName !== 'chromium');
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const baseURL = testInfo.project.use.baseURL as string;
  await page.goto(new URL('/chat-launcher', baseURL).toString());
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.synthesizePinchGesture', {
    x: 320,
    y: 700,
    scaleFactor: 2,
    relativeSpeed: 800,
    gestureSourceType: 'touch',
  });
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
  await cdp.send('Input.synthesizeScrollGesture', {
    x: 180,
    y: 400,
    xDistance: 80,
    yDistance: 120,
    speed: 800,
    gestureSourceType: 'touch',
  });
  const viewport = await page.evaluate(() => ({
    left: window.visualViewport?.offsetLeft ?? 0,
    top: window.visualViewport?.offsetTop ?? 0,
    width: window.visualViewport?.width ?? window.innerWidth,
    height: window.visualViewport?.height ?? window.innerHeight,
    scale: window.visualViewport?.scale ?? 1,
  }));
  expect(viewport.scale).toBeGreaterThan(1);
  expect(viewport.width).toBeLessThan(390);
  expect(viewport.height).toBeLessThan(844);

  const launcher = page.getByRole('button', { name: 'Open AI chat assistant' });
  const bounds = await launcher.boundingBox();
  if (!bounds) throw new Error('Chat launcher is missing its layout box');
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(viewport.left + viewport.width - 2, viewport.top + 2, {
    steps: 4,
  });
  await page.mouse.up();

  const finalBounds = await launcher.boundingBox();
  if (!finalBounds) throw new Error('Chat launcher lost its layout box');
  expect(finalBounds.x).toBeGreaterThanOrEqual(viewport.left + 12);
  expect(finalBounds.y).toBeGreaterThanOrEqual(viewport.top + 12);
  expect(finalBounds.x + finalBounds.width).toBeLessThanOrEqual(
    viewport.left + viewport.width - 12
  );
  expect(finalBounds.y + finalBounds.height).toBeLessThanOrEqual(
    viewport.top + viewport.height - 12
  );
  await context.close();
});
