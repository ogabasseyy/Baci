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
      'Crypto payment modal closed.'
    );
  }
});

test('renders the modal with storefront layout styles and fixture merchant theme', async ({
  page,
}) => {
  await page.goto('/crypto-payment-modal');
  await page.getByRole('button', { name: 'Open crypto payment modal' }).click();

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

  const cardBackground = await page
    .locator('.fixed.inset-0 > div')
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        maxWidth: style.maxWidth,
        backgroundColor: style.backgroundColor,
      };
    });
  expect(cardBackground).toEqual({
    maxWidth: '448px',
    backgroundColor: 'rgb(255, 255, 255)',
  });

  const themedCurrencyColor = await page
    .locator('p')
    .filter({ hasText: '1,250 USDT' })
    .locator('span')
    .evaluate((element) => getComputedStyle(element).color);
  expect(themedCurrencyColor).toBe('rgb(105, 65, 198)');
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
    'Crypto payment modal closed.'
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
    'Crypto payment modal closed.'
  );
});

test('payment verification action enters checking state and disables repeat actions', async ({
  page,
}) => {
  await page.goto('/crypto-payment-modal');
  await page.getByRole('button', { name: 'Open crypto payment modal' }).click();
  await page.getByRole('button', { name: "I've Sent the Payment" }).click();

  await expect(page.getByText('Checking payment status...')).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Verifying Payment/ })
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Close and check order status later' })
  ).toBeHidden();
});

test('copies the synthetic recipient address with the browser clipboard', async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Clipboard permissions are Chromium-only here.'
  );
  await page.clock.install();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/crypto-payment-modal');
  await page.getByRole('button', { name: 'Open crypto payment modal' }).click();
  await page.clock.pauseAt(new Date(Date.now() + 10_000));
  await page.getByTitle('Copy Address').click();

  await expect(page.getByTitle('Copied!')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(fixtureAddress);
  await page.clock.runFor(1999);
  await expect(page.getByTitle('Copied!')).toBeVisible();
  await page.clock.runFor(1);
  await expect(page.getByTitle('Copy Address')).toBeVisible();
});
