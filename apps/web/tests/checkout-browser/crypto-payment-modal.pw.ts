import { expect, test } from './network';

const fixtureAddress = 'T7WHdR7vj4i3L4575w8V5hV8tKf9w2Q3xY';

test('shows each verification state in the real modal with a local QR image', async ({
  page,
}) => {
  await page.goto('/crypto-payment-modal');

  for (const state of ['idle', 'checking', 'pending', 'confirmed', 'failed']) {
    await page.getByRole('radio', { name: state }).check();
    await page
      .getByRole('button', { name: 'Open crypto payment modal' })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Pay with Crypto' })
    ).toBeVisible();
    await expect(page.getByText(fixtureAddress)).toBeVisible();
    await expect(page.getByRole('img', { name: 'Scan' })).toHaveAttribute(
      'src',
      /^data:image\/svg\+xml,/
    );

    if (state === 'checking')
      await expect(page.getByText('Checking payment status...')).toBeVisible();
    if (state === 'pending')
      await expect(
        page.getByText('Waiting for blockchain confirmation...')
      ).toBeVisible();
    if (state === 'confirmed')
      await expect(page.getByText(/Payment confirmed!/)).toBeVisible();
    if (state === 'failed')
      await expect(page.getByText(/Payment verification failed/)).toBeVisible();

    await page
      .getByRole('button', { name: 'Close crypto payment modal' })
      .click();
    await expect(page.getByRole('status')).toContainText(
      'Modal closed from header.'
    );
  }
});

test('header close dismisses immediately without a browser confirmation', async ({
  page,
}) => {
  const dialogs: string[] = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  await page.goto('/crypto-payment-modal');
  await page.getByRole('button', { name: 'Open crypto payment modal' }).click();
  await page
    .getByRole('button', { name: 'Close crypto payment modal' })
    .click();

  await expect(page.getByRole('status')).toContainText(
    'Modal closed from header.'
  );
  expect(dialogs).toEqual([]);
});

test('footer close can be canceled or accepted by the browser confirmation', async ({
  page,
}) => {
  const expectedMessage =
    "Are you sure you want to close? If you've already sent payment, your order will still be processed once the payment is detected.";
  await page.goto('/crypto-payment-modal');
  await page.getByRole('button', { name: 'Open crypto payment modal' }).click();
  const closeLater = page.getByRole('button', {
    name: 'Close and check order status later',
  });

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toBe(expectedMessage);
    await dialog.dismiss();
  });
  await closeLater.click();
  await expect(
    page.getByRole('heading', { name: 'Pay with Crypto' })
  ).toBeVisible();

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toBe(expectedMessage);
    await dialog.accept();
  });
  await closeLater.click();
  await expect(page.getByRole('status')).toContainText(
    'Modal closed from order status.'
  );
});

test('copies the synthetic recipient address with the browser clipboard', async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Clipboard permissions are Chromium-only here.'
  );
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/crypto-payment-modal');
  await page.getByRole('button', { name: 'Open crypto payment modal' }).click();
  await page.getByTitle('Copy Address').click();

  await expect(page.getByTitle('Copied!')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(fixtureAddress);
});
