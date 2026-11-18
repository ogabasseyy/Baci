import assert from 'node:assert/strict';
import type { FrameLocator, Page } from 'playwright-core';
export function validateNativeAnchor(
  href: string,
  target: string | null,
  rel: string | null
) {
  if (
    href !== 'http://127.0.0.1:4100/products/device' ||
    target !== '_blank' ||
    rel !== 'noopener noreferrer'
  )
    throw Error('Unsafe canonical native anchor');
}
export async function checkNativeLinks(page: Page, frame: FrameLocator) {
  const request = frame.getByRole('button', {
    name: 'Request trusted product link',
  });
  await request.click();
  await request.click();
  assert.equal(page.context().pages().length, 1);
  assert.equal(await page.locator('#canonical').count(), 1);
  const anchor = page.locator('#canonical');
  validateNativeAnchor(
    await anchor.evaluate((e) => (e as HTMLAnchorElement).href),
    await anchor.getAttribute('target'),
    await anchor.getAttribute('rel')
  );
  for (const gesture of ['primary', 'keyboard', 'middle', 'modified']) {
    const popupEvent = page.context().waitForEvent('page');
    if (gesture === 'keyboard') {
      await anchor.focus();
      await page.keyboard.press('Enter');
    } else
      await anchor.click(
        gesture === 'middle'
          ? { button: 'middle' }
          : gesture === 'modified'
            ? { modifiers: ['Control'] }
            : {}
      );
    const popup = await popupEvent;
    await popup.waitForLoadState('domcontentloaded');
    assert.equal(new URL(popup.url()).pathname, '/products/device');
    assert.equal(await popup.evaluate(() => window.opener), null);
    await popup.close();
  }
  await page.getByRole('button', { name: 'Cancel link' }).click();
  assert.equal(await page.locator('#presentation').isVisible(), false);
  await request.click();
  await page.locator('#same-tab').click();
  await page.waitForURL('http://127.0.0.1:4100/products/device');
  return {
    trustedNativeGestures: 4,
    replaySinglePresentation: true,
    cancelAndSameTab: true,
    noFramePopupPermission: true,
  };
}
