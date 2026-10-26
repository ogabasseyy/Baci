import { expect, test } from '@playwright/test';

test('WebKit touch compatibility click without pointerId stays suppressed', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.use.browserName !== 'webkit',
    'Exercises the iOS Safari MouseEvent click shape in WebKit'
  );
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/chat-launcher');
  await page
    .getByRole('button', { name: 'Assistant launcher' })
    .evaluate((button) => {
      const launcher = button as HTMLButtonElement;
      // Synthetic pointer sequences do not participate in browser pointer capture.
      launcher.setPointerCapture = () => undefined;
      const pointer = (type: string, x: number, y: number) =>
        launcher.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            button: 0,
            clientX: x,
            clientY: y,
            isPrimary: true,
            pointerId: 71,
            pointerType: 'touch',
          })
        );
      pointer('pointerdown', 220, 320);
      pointer('pointermove', 1, 1);
      pointer('pointerup', 1, 1);
      // iOS Safari dispatches touch compatibility clicks as MouseEvents.
      launcher.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          detail: 1,
          clientX: 1,
          clientY: 1,
        })
      );
    });
  await expect(page.getByTestId('deferred-launcher')).toBeVisible();
  await expect(page.getByTestId('runtime-launcher')).toHaveCount(0);

  await page
    .getByRole('button', { name: 'Assistant launcher' })
    .evaluate((button) => {
      const launcher = button as HTMLButtonElement;
      const bounds = launcher.getBoundingClientRect();
      const x = bounds.x + bounds.width / 2;
      const y = bounds.y + bounds.height / 2;
      const pointer = (type: string) =>
        launcher.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            button: 0,
            clientX: x,
            clientY: y,
            isPrimary: true,
            pointerId: 72,
            pointerType: 'touch',
          })
        );
      pointer('pointerdown');
      pointer('pointerup');
      launcher.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          detail: 1,
          clientX: x,
          clientY: y,
        })
      );
    });
  await expect(page.getByTestId('chat-window')).toBeVisible();
});
