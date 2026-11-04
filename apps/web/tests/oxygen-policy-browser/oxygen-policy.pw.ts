import { createServer, type Server } from 'node:http';
import { expect, test } from '@playwright/test';
import { NextRequest, NextResponse } from 'next/server';
import { applySecurityHeaders } from '../../src/lib/proxy/response-headers';

const frameOrigin = 'https://frame.example.test';
const orderId = '6974e8cc-4e90-4ca9-b2cf-aa2abaf461df';
let server: Server;
let base: string;

test.beforeAll(async () => {
  process.env.VERCEL_ENV = 'preview';
  process.env.OXYGEN_STAGING_HOSTED_HOSTS = 'frame.example.test';
  process.env.OXYGEN_STAGING_SELFIE_HOSTS = 'frame.example.test';
  server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', base);
    const source = new NextRequest(requestUrl);
    const policy = applySecurityHeaders(
      NextResponse.next(),
      requestUrl.pathname,
      'test',
      'storefront',
      false,
      undefined,
      source
    );
    for (const header of ['content-security-policy', 'permissions-policy']) {
      const value = policy.headers.get(header);
      if (value) response.setHeader(header, value);
    }
    response.setHeader('content-type', 'text/html');
    response.end(
      `<!doctype html><title>Checkout fixture</title><a href="/checkout?oxygenOrderId=${orderId}">Resume</a><iframe title="synthetic frame" src="${frameOrigin}/fixture"></iframe>`
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing fixture address');
  base = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  delete process.env.VERCEL_ENV;
  delete process.env.OXYGEN_STAGING_HOSTED_HOSTS;
  delete process.env.OXYGEN_STAGING_SELFIE_HOSTS;
});

test('ordinary checkout and an unverified Oxygen URL both block the frame', async ({
  page,
}) => {
  await page.route(`${frameOrigin}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<p>Synthetic frame loaded</p>',
    })
  );
  const violations: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') violations.push(message.text());
  });
  const ordinary = await page.goto(`${base}/checkout`);
  expect(ordinary?.headers()['content-security-policy']).not.toContain(
    frameOrigin
  );
  await expect
    .poll(() =>
      violations.some((message) => message.includes('Content Security Policy'))
    )
    .toBe(true);
  await expect(
    page.frameLocator('iframe').getByText('Synthetic frame loaded')
  ).toHaveCount(0);
  const responsePromise = page.waitForResponse((response) =>
    response.url().includes(`oxygenOrderId=${orderId}`)
  );
  await page.getByRole('link', { name: 'Resume' }).click();
  const resumed = await responsePromise;
  expect(resumed.headers()['content-security-policy']).not.toContain(
    frameOrigin
  );
  expect(resumed.headers()['permissions-policy']).not.toContain(frameOrigin);
  await expect(
    page.frameLocator('iframe').getByText('Synthetic frame loaded')
  ).toHaveCount(0);
});

test('a custom-domain-shaped checkout receives the same scoped document policies', async ({
  page,
}) => {
  await page.route(`${frameOrigin}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<p>Synthetic frame loaded</p>',
    })
  );
  await page.route('https://shop.example.test/**', async (route) => {
    const request = new NextRequest(route.request().url());
    const policy = applySecurityHeaders(
      NextResponse.next(),
      request.nextUrl.pathname,
      'test',
      'storefront',
      false,
      undefined,
      request
    );
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/html',
        'content-security-policy':
          policy.headers.get('content-security-policy') ?? '',
        'permissions-policy': policy.headers.get('permissions-policy') ?? '',
      },
      body: `<!doctype html><a href="/checkout?oxygenOrderId=${orderId}">Resume</a><iframe title="synthetic frame" src="${frameOrigin}/fixture"></iframe>`,
    });
  });
  const ordinary = await page.goto('https://shop.example.test/checkout');
  expect(ordinary?.headers()['content-security-policy']).not.toContain(
    frameOrigin
  );
  await expect(
    page.frameLocator('iframe').getByText('Synthetic frame loaded')
  ).toHaveCount(0);
  const resumedResponse = page.waitForResponse((response) =>
    response.url().includes(`oxygenOrderId=${orderId}`)
  );
  await page.getByRole('link', { name: 'Resume' }).click();
  expect(
    (await resumedResponse).headers()['content-security-policy']
  ).not.toContain(frameOrigin);
  await expect(
    page.frameLocator('iframe').getByText('Synthetic frame loaded')
  ).toHaveCount(0);
});
