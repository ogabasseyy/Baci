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

test('mobile offer suppression keeps a moved launcher reachable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.setContent(`
    <style>${overlayCss}\n${chatCss}</style>
    <div class="ogabassey-chat-anchor" data-chat-launcher-positioned>
      <button class="ogabassey-chat-button">Assistant</button>
    </div>
    <div class="ogabassey-offer-popup">Sponsored offer</div>
  `);

  await expect(page.locator('.ogabassey-chat-anchor')).toBeVisible();
  await expect(page.locator('.ogabassey-offer-popup')).toBeVisible();
  await page.locator('.ogabassey-chat-anchor').evaluate((anchor) => {
    anchor.setAttribute('data-chat-launcher-offer-collision', '');
  });
  await expect(page.locator('.ogabassey-offer-popup')).toBeHidden();
  await expect(page.locator('.ogabassey-chat-anchor')).toBeVisible();
});

test('launcher help is announced and keyboard movement preserves position', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/chat-launcher');

  const launcher = page.getByRole('button', { name: 'Open AI chat assistant' });
  await expect(launcher).toHaveAttribute(
    'aria-keyshortcuts',
    'ArrowUp ArrowDown ArrowLeft ArrowRight'
  );
  const helpId = await launcher.getAttribute('aria-describedby');
  expect(helpId).toBeTruthy();
  const descriptionIsInsideButton = await launcher.evaluate((button) => {
    const help = document.getElementById(
      button.getAttribute('aria-describedby') ?? ''
    );
    return help !== null && button.contains(help);
  });
  expect(descriptionIsInsideButton).toBe(false);
  const initialBounds = await launcher.boundingBox();
  if (!initialBounds)
    throw new Error('Chat launcher is missing its layout box');

  await launcher.focus();
  await page.keyboard.press('ArrowDown');

  const movedBounds = await launcher.boundingBox();
  if (!movedBounds) throw new Error('Chat launcher lost its layout box');
  expect(movedBounds.y).toBe(initialBounds.y);
});

test('a dragged-away launcher remains visible when the mobile offer appears', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/chat-launcher');
  const launcher = page.getByRole('button', { name: 'Open AI chat assistant' });
  const initial = await launcher.boundingBox();
  if (!initial) throw new Error('Chat launcher is missing its layout box');
  await page.mouse.move(initial.x + 28, initial.y + 28);
  await page.mouse.down();
  await page.mouse.move(80, 120, { steps: 4 });
  await page.mouse.up();
  await launcher.evaluate((button) => button.blur());

  const anchor = page.locator('.ogabassey-chat-anchor');
  await expect(anchor).toHaveAttribute('data-chat-launcher-positioned', '');
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div class="ogabassey-offer-popup" style="position:fixed;right:16px;bottom:16px;width:140px;height:72px">Sponsored offer</div>'
    );
  });

  await expect(anchor).toBeVisible();
  await expect(page.locator('.ogabassey-offer-popup')).toHaveCSS(
    'visibility',
    'visible'
  );
  await expect(anchor).not.toHaveAttribute(
    'data-chat-launcher-offer-collision',
    ''
  );
});

test('offer collision includes a visible launcher overflow bubble', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/chat-launcher');
  const launcher = page.getByRole('button', { name: 'Open AI chat assistant' });
  const initial = await launcher.boundingBox();
  if (!initial) throw new Error('Chat launcher is missing its layout box');
  await page.mouse.move(initial.x + 28, initial.y + 28);
  await page.mouse.down();
  await page.mouse.move(228, 228, { steps: 4 });
  await page.mouse.up();
  await launcher.evaluate((button) => button.blur());

  const anchor = page.locator('.ogabassey-chat-anchor');
  await anchor.evaluate((element) => {
    const button = element.querySelector('.ogabassey-chat-button');
    if (!button) throw new Error('Launcher button is missing');
    const buttonRect = button.getBoundingClientRect();
    const anchorRect = element.getBoundingClientRect();
    const bubble = document.createElement('div');
    bubble.dataset.chatLauncherOverflow = '';
    bubble.style.cssText = `position:absolute;left:${buttonRect.left - anchorRect.left - 110}px;top:${buttonRect.top - anchorRect.top - 40}px;width:100px;height:35px`;
    element.append(bubble);
    const bubbleRect = bubble.getBoundingClientRect();
    const offer = document.createElement('div');
    offer.className = 'ogabassey-offer-popup';
    offer.textContent = 'Sponsored offer';
    offer.style.cssText = `position:fixed;left:${bubbleRect.left}px;top:${bubbleRect.top}px;width:${bubbleRect.width}px;height:${bubbleRect.height}px`;
    document.body.append(offer);
  });

  await expect(anchor).toHaveAttribute(
    'data-chat-launcher-offer-collision',
    ''
  );
  await expect(page.locator('.ogabassey-offer-popup')).toBeHidden();
  await expect(launcher).toBeVisible();
});
