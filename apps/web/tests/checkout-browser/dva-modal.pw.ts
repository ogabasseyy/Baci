import { expect, test } from './network';

const fixtureAccount = '1234567890';

test('renders the themed DVA modal and retains amount, copy, verify, and close actions', async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Clipboard permissions are Chromium-only here.'
  );
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/dva-modal');
  await page.getByRole('button', { name: 'Open DVA modal' }).click();

  await expect(
    page.getByRole('heading', { name: 'Bank Transfer' })
  ).toBeVisible();
  await expect(page.getByText('₦750')).toBeVisible();
  await expect(page.getByText(fixtureAccount)).toBeVisible();
  await expect(page.getByText('Fixture Bank')).toBeVisible();
  await expect(page.getByText('fixture-dva-reference')).toBeVisible();

  await expect
    .poll(() =>
      page.evaluate(() =>
        document.documentElement.style.getPropertyValue('--store-primary')
      )
    )
    .toBe('#6941c6');
  const modalLayout = await page
    .locator('.fixed.inset-0')
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return { display: style.display, position: style.position };
    });
  expect(modalLayout).toEqual({ display: 'flex', position: 'fixed' });

  await page.getByRole('button', { name: 'Copy account number' }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(fixtureAccount);
  await expect(
    page.getByRole('button', { name: 'Copy account number' })
  ).toHaveClass(/border-green-300/);

  await page.getByRole('button', { name: 'Confirm Transfer Sent' }).click();
  await expect(
    page.getByRole('button', { name: 'Verifying transfer…' })
  ).toBeDisabled();

  await page.getByRole('button', { name: 'Close and check later' }).click();
  await expect(page.getByRole('status')).toHaveText('DVA modal closed.');
  await page.getByRole('button', { name: 'Open DVA modal' }).click();
  await expect(
    page.getByRole('button', { name: 'Confirm Transfer Sent' })
  ).toBeEnabled();
  await expect(
    page.getByRole('button', { name: 'Copy account number' })
  ).not.toHaveClass(/border-green-300/);
  await page.getByRole('button', { name: 'Close bank transfer modal' }).click();
  await expect(page.getByRole('status')).toHaveText('DVA modal closed.');
});
