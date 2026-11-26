import { chromium } from 'playwright-core';
import { expect } from 'vitest';
import { observeNativeCheckout } from '../../tools/experience-runner/public-observation-native-checkout';
import { fillSyntheticStorefrontCheckout } from './synthetic-checkout-form.test-support';

/** Runs Baci's real local storefront while blocking all order and external traffic. */
export async function checkPublicStorefrontBrowser(input: {
  storefrontOrigin: string;
  gatewayOrigin: string;
  dataOrigin: string;
  dataKey?: string;
  stopAfterFrame?: boolean;
  nativeProductId?: string;
}) {
  // The synthetic HTTPS origin reaches a loopback-only Data API in this test.
  // Production uses HTTPS services and must be qualified separately.
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-features=LocalNetworkAccessChecks'],
  });
  const context = await browser.newContext({
    serviceWorkers: 'block',
    viewport: { width: 1280, height: 900 },
  });
  const writes = new Set([
    '/api/storefront/experience/launch',
    '/api/storefront/cart/bootstrap',
    '/api/storefront/cart',
    '/api/storefront/cart/commands',
    '/api/storefront/cart/checkout',
    '/api/shipping/quotes',
  ]);
  const paths: string[] = [];
  const errors: string[] = [];
  let page: import('playwright-core').Page | undefined;
  try {
    await context.routeWebSocket(/.*/, (socket) => {
      const url = new URL(socket.url());
      if (
        url.origin !== 'wss://synthetic.synthetic.test' ||
        url.pathname !== '/_next/hmr'
      ) {
        void socket.close();
        return;
      }
      const upstream = new WebSocket(
        `${input.storefrontOrigin.replace(/^http/, 'ws')}${url.pathname}${url.search}`
      );
      upstream.binaryType = 'arraybuffer';
      const pending: Array<string | Buffer> = [];
      const sendUpstream = (message: string | Buffer) =>
        upstream.send(
          typeof message === 'string' ? message : Uint8Array.from(message)
        );
      socket.onMessage((message) => {
        if (upstream.readyState === WebSocket.OPEN) sendUpstream(message);
        else pending.push(message);
      });
      socket.onClose(() => upstream.close());
      upstream.addEventListener('open', () => {
        for (const message of pending) sendUpstream(message);
      });
      upstream.addEventListener('message', (event) => {
        if (typeof event.data === 'string') socket.send(event.data);
        else if (event.data instanceof ArrayBuffer)
          socket.send(Buffer.from(event.data));
      });
      upstream.addEventListener('close', () => {
        void socket.close();
      });
      upstream.addEventListener('error', () => {
        void socket.close();
      });
    });
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        url.origin === input.dataOrigin &&
        ['GET', 'OPTIONS'].includes(request.method()) &&
        url.pathname === '/rest/v1/products'
      ) {
        if (request.method() === 'GET') {
          const headers = request.headers();
          errors.push(
            `DATA_KEY_MATCH ${headers.apikey === input.dataKey} AUTH_KEY_MATCH ${headers.authorization === `Bearer ${input.dataKey}`}`
          );
        }
        return route.continue();
      }
      if (
        url.origin === 'https://output.synthetic-output.test' &&
        request.method() === 'GET'
      ) {
        const response = await route.fetch({
          url: `${input.gatewayOrigin}${url.pathname}${url.search}`,
          maxRedirects: 0,
        });
        return route.fulfill({ response });
      }
      if (url.origin === 'https://synthetic.synthetic.test') {
        if (
          input.nativeProductId &&
          url.pathname.startsWith('/api/storefront/cart')
        ) {
          errors.push('UNEXPECTED_SHARED_CART_REQUEST');
          return route.abort('blockedbyclient');
        }
        if (
          request.method() !== 'GET' &&
          !(request.method() === 'POST' && writes.has(url.pathname))
        )
          return route.abort('blockedbyclient');
        paths.push(`${request.method()} ${url.pathname}`);
        if (url.pathname.startsWith('/api/storefront/cart')) {
          const cookies = (request.headers().cookie ?? '')
            .split(';')
            .map((part) => part.trim().split('=')[0])
            .filter(Boolean);
          errors.push(
            `CART_REQUEST ${request.method()} ${url.pathname} cookieNames=${cookies.join(',')}`
          );
        }
        const headers: Record<string, string> = {
          ...request.headers(),
          host: new URL(input.storefrontOrigin).host,
          'x-forwarded-host': new URL(input.storefrontOrigin).host,
          'x-forwarded-proto': 'http',
        };
        if (headers.origin) headers.origin = input.storefrontOrigin;
        if (headers.referer)
          headers.referer = `${input.storefrontOrigin}/synthetic`;
        const response = await route.fetch({
          url: `${input.storefrontOrigin}${url.pathname}${url.search}`,
          headers,
          maxRedirects: 0,
          timeout: 120000,
        });
        if (url.pathname.startsWith('/api/storefront/cart')) {
          errors.push(
            `CART_RESPONSE ${request.method()} ${url.pathname} ${response.status()} setCookie=${response.headers()['set-cookie'] ? 'yes' : 'no'}`
          );
        }
        return route.fulfill({ response });
      }
      return route.abort('blockedbyclient');
    });
    page = await context.newPage();
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (event) => {
        console.error(`CSP ${event.violatedDirective}: ${event.blockedURI}`);
      });
    });
    page.on('response', (response) => {
      if (response.status() >= 400)
        errors.push(
          `HTTP ${response.status()} ${new URL(response.url()).pathname}`
        );
      if (
        response.status() === 401 &&
        response.url().startsWith(`${input.dataOrigin}/rest/v1/products`)
      ) {
        void response
          .json()
          .then((body: { code?: unknown }) => {
            errors.push(`PRODUCT_AUTH_CODE ${String(body.code ?? 'unknown')}`);
          })
          .catch(() => errors.push('PRODUCT_AUTH_CODE unreadable'));
      }
    });
    page.on('requestfailed', (request) => {
      errors.push(
        `FAILED ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`
      );
    });
    page.on('pageerror', (error) => errors.push(error.message.slice(0, 300)));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text().slice(0, 300));
    });
    const initial = await page.goto(
      'https://synthetic.synthetic.test/synthetic',
      {
        waitUntil: 'domcontentloaded',
        timeout: 90000,
      }
    );
    if (!initial || initial.status() >= 400)
      throw Error(`STOREFRONT_HTTP_${initial?.status() ?? 0}`);
    const frame = page.frameLocator('iframe[title="Storefront experience"]');
    if (input.stopAfterFrame) {
      await page
        .locator('iframe[title="Storefront experience"]')
        .waitFor({ timeout: 15000, state: 'attached' });
      return { checkoutUrl: page.url(), paths };
    }
    await frame
      .locator('html[data-baci-hydration="ready"]')
      .waitFor({ timeout: 90000 });
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-experience-semantic-fallback]')
          ?.hasAttribute('hidden') === true,
      undefined,
      { timeout: 90000 }
    );
    await frame
      .getByText('Synthetic New Merchant Device')
      .waitFor({ timeout: 30000 });
    if (input.nativeProductId) {
      await page.waitForFunction(
        () => document.title === 'Synthetic New Merchant · home',
        undefined,
        { timeout: 15000 }
      );
      const path = '/synthetic/products/synthetic-new-device';
      const response = await page.goto(new URL(path, page.url()).href, {
        waitUntil: 'domcontentloaded',
        timeout: 90000,
      });
      expect(response?.status()).toBe(200);
      await observeNativeCheckout(
        page,
        { id: input.nativeProductId, path },
        { merchantSlug: 'synthetic' },
        new URL('/synthetic/checkout', page.url()).href
      );
    } else {
      await frame.getByRole('button', { name: 'Add to cart' }).click();
      await frame.getByText('Added to cart').waitFor({ timeout: 45000 });
      await frame.getByRole('button', { name: 'Review checkout' }).click();
      const dialog = page.getByRole('dialog', { name: 'Continue to checkout' });
      await dialog.waitFor({ timeout: 45000 });
      await dialog
        .getByRole('button', { name: 'Continue to checkout' })
        .click();
    }
    await fillSyntheticStorefrontCheckout(page);
    if (input.nativeProductId)
      expect(errors).not.toContain('UNEXPECTED_SHARED_CART_REQUEST');
    else expect(paths).toContain('POST /api/storefront/cart/checkout');
    expect(paths).toContain('POST /api/shipping/quotes');
    expect(paths.some((path) => /order|payment/i.test(path))).toBe(false);
    return { checkoutUrl: page.url(), paths };
  } catch (error) {
    const frameBodies = await Promise.all(
      (page?.frames() ?? []).slice(1).map(async (frame) => ({
        url: frame.url().split('?')[0],
        body: await frame
          .locator('body')
          .innerText({ timeout: 3000 })
          .then((value) => value.slice(0, 1000))
          .catch(() => 'unavailable'),
      }))
    );
    const diagnostics = await page
      ?.evaluate(() => ({
        ready: document.readyState,
        scripts: document.scripts.length,
        nextData: typeof (window as Window & { __next_f?: unknown }).__next_f,
        nextPush: String(
          (window as Window & { __next_f?: { push?: unknown } }).__next_f?.push
        ).slice(0, 100),
        webpack: typeof (window as Window & { webpackChunk_N_E?: unknown })
          .webpackChunk_N_E,
        next: typeof (window as Window & { next?: unknown }).next,
        reactKey: Object.keys(
          document.querySelector('[data-experience-semantic-fallback]') ?? {}
        ).filter((key) => key.startsWith('__react')),
        fallback: document
          .querySelector('[data-experience-pending]')
          ?.outerHTML.slice(0, 400),
      }))
      .catch(() => null);
    const body = await page
      ?.locator('body')
      .innerText({ timeout: 3000 })
      .catch(() => 'unavailable');
    throw new Error(
      `SYNTHETIC_BROWSER_FLOW_FAILED: ${error instanceof Error ? error.message : 'unknown'}; diagnostics=${JSON.stringify(diagnostics)}; frames=${JSON.stringify(frameBodies)}; paths=${paths.join(',')}; errors=${errors.join('|')}; body=${body?.slice(0, 1500)}`
    );
  } finally {
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
    await browser.close();
  }
}
