import { expect, type Page } from '@playwright/test';

export async function waitForSuccessfulCartValidation(page: Page) {
  const response = await page.waitForResponse((candidate) => {
    const request = candidate.request();
    return (
      new URL(candidate.url()).pathname === '/api/cart/validate' &&
      request.method() === 'POST'
    );
  });

  expect(await response.finished()).toBeNull();
  expect(response.status()).toBe(200);
}
