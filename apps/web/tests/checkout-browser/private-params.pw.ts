import { expect, test } from './network';

// Real-browser check of the order-token scrub: the address bar is cleaned, the
// page keeps the value across a reload and a fragment link, and Next.js's own
// router state follows the cleaned address.
test('keeps the order token out of the address bar but on the page, across reload and a fragment link', async ({
  page,
}) => {
  await page.goto('/private-params?orderId=1&token=secret-token');

  await expect(page.getByText('Token: secret-token')).toBeVisible();
  await expect.poll(() => page.url()).not.toContain('secret-token');
  await expect(page.getByText('Router query: orderId=1')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Token: secret-token')).toBeVisible();
  expect(page.url()).not.toContain('secret-token');

  await page.getByRole('link', { name: 'Skip to main content' }).click();
  await expect(page).toHaveURL(/#main$/);
  await expect(page.getByText('Token: secret-token')).toBeVisible();
  expect(page.url()).not.toContain('secret-token');

  await page.reload();
  await expect(page.getByText('Token: secret-token')).toBeVisible();
  expect(page.url()).not.toContain('secret-token');
});
