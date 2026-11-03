import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('https://frame.example.test/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<p>Synthetic Oxygen frame loaded</p>',
    })
  );
});

test('custom-domain checkout grants Oxygen policy only to the matching signed-in owner', async ({
  page,
  context,
}) => {
  const order = '6974e8cc-4e90-4ca9-b2cf-aa2abaf461df';
  const url = `http://127.0.0.1:3297/checkout?oxygenOrderId=${order}`;
  const anonymous = await page.goto(url);
  expect(anonymous?.status()).toBe(200);
  await expect(
    page.frameLocator('iframe').getByText('Synthetic Oxygen frame loaded')
  ).toHaveCount(0);
  expect(anonymous?.headers()['content-security-policy']).not.toContain(
    'frame.example.test'
  );
  const valid = `e30.${Buffer.from(JSON.stringify({ sub: 'synthetic-user', exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })).toString('base64url')}.sig`;
  const session = `base64-${Buffer.from(JSON.stringify({ access_token: valid, refresh_token: 'synthetic-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: 'bearer', user: { id: 'synthetic-user', aud: 'authenticated', role: 'authenticated' } })).toString('base64url')}`;
  await context.addCookies([
    {
      name: 'sb-fixture-auth-token',
      value: session,
      url: 'http://127.0.0.1:3297',
    },
  ]);
  const owner = await page.goto(url);
  expect(owner?.status()).toBe(200);
  await expect(
    page.frameLocator('iframe').getByText('Synthetic Oxygen frame loaded')
  ).toBeVisible();
  expect(owner?.headers()['content-security-policy']).toContain(
    'https://frame.example.test'
  );
  expect(owner?.headers()['permissions-policy']).toContain(
    'https://frame.example.test'
  );
  expect(owner?.headers()['cache-control']).toContain('no-store');
  const foreign = await page.goto(`${url}&case=foreign`);
  expect(foreign?.status()).toBe(200);
  await expect(
    page.frameLocator('iframe').getByText('Synthetic Oxygen frame loaded')
  ).toHaveCount(0);
  expect(foreign?.headers()['content-security-policy']).not.toContain(
    'frame.example.test'
  );
  const otherPayment = await page.goto(`${url}&case=non-oxygen`);
  expect(otherPayment?.status()).toBe(200);
  expect(otherPayment?.headers()['content-security-policy']).not.toContain(
    'frame.example.test'
  );
  const wrongMerchant = await page.goto(`${url}&case=wrong-merchant`);
  expect(wrongMerchant?.status()).toBe(200);
  expect(wrongMerchant?.headers()['content-security-policy']).not.toContain(
    'frame.example.test'
  );
});

test('custom-domain ownership policy survives a real synthetic SSR session refresh', async ({
  page,
  context,
}) => {
  const expired = `e30.${Buffer.from(JSON.stringify({ sub: 'synthetic-user', exp: 1, role: 'authenticated' })).toString('base64url')}.sig`;
  const session = `base64-${Buffer.from(JSON.stringify({ access_token: expired, refresh_token: 'synthetic-old-refresh', expires_at: 1, expires_in: 3600, token_type: 'bearer', user: { id: 'synthetic-user', aud: 'authenticated', role: 'authenticated' } })).toString('base64url')}`;
  await context.addCookies([
    {
      name: 'sb-fixture-auth-token',
      value: session,
      url: 'http://127.0.0.1:3297',
    },
  ]);
  const response = await page.goto(
    'http://127.0.0.1:3297/checkout?oxygenOrderId=6974e8cc-4e90-4ca9-b2cf-aa2abaf461df&case=large'
  );
  expect(response?.status()).toBe(200);
  expect(page.url()).toContain('__oxygen_policy_refresh=');
  expect(response?.headers()['content-security-policy']).toContain(
    'https://frame.example.test'
  );
  const forwarded = JSON.parse(await page.locator('pre').innerText());
  expect(forwarded.domain).toBe('shop.example.test');
  const saved = (await context.cookies()).filter((cookie) =>
    /^sb-fixture-auth-token\.\d+$/.test(cookie.name)
  );
  expect(saved.length).toBeGreaterThanOrEqual(2);
  for (const cookie of saved)
    expect(forwarded.cookie).toContain(`${cookie.name}=${cookie.value}`);
});

for (const [label, path] of [
  ['subdomain', '/checkout?mode=subdomain'],
  ['slug', '/trusted-shop/checkout?mode=slug'],
] as const) {
  test(`${label} checkout refreshes an owner session and enforces its document policy`, async ({
    page,
    context,
  }) => {
    const order = '6974e8cc-4e90-4ca9-b2cf-aa2abaf461df';
    const expired = `e30.${Buffer.from(JSON.stringify({ sub: 'synthetic-user', exp: 1, role: 'authenticated' })).toString('base64url')}.sig`;
    const session = `base64-${Buffer.from(JSON.stringify({ access_token: expired, refresh_token: 'synthetic-old-refresh', expires_at: 1, expires_in: 3600, token_type: 'bearer', user: { id: 'synthetic-user', aud: 'authenticated', role: 'authenticated' } })).toString('base64url')}`;
    await context.addCookies([
      {
        name: 'sb-fixture-auth-token',
        value: session,
        url: 'http://127.0.0.1:3297',
      },
    ]);
    const url = `http://127.0.0.1:3297${path}&oxygenOrderId=${order}&case=large`;
    const result = await page.goto(url, {
      headers: { 'x-merchant-slug': 'forged' },
    });
    expect(result?.status()).toBe(200);
    expect(page.url()).toContain('__oxygen_policy_refresh=');
    expect(result?.headers()['content-security-policy']).toContain(
      'https://frame.example.test'
    );
    await expect(
      page.frameLocator('iframe').getByText('Synthetic Oxygen frame loaded')
    ).toBeVisible();
    const foreignUrl = new URL(url);
    foreignUrl.searchParams.set('case', 'foreign');
    const denied = await page.goto(foreignUrl.toString());
    expect(denied?.status()).toBe(200);
    expect(denied?.headers()['content-security-policy']).not.toContain(
      'frame.example.test'
    );
  });
}
