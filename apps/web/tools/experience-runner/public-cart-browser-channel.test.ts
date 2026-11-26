import { PassThrough } from 'node:stream';
import { chromium } from 'playwright-core';
import { expect, it, vi } from 'vitest';
import { createPublicCartSession } from '../experience-verifier/public-cart-session';
import { installPublicCartBrowserRoutes } from './public-cart-browser-route';
import { runPublicCartChannel } from './public-cart-channel';
import { createPublicCartWorkerClient } from './public-cart-worker-client';

it('passes real browser requests through both sides of the bounded channel', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const toHost = new PassThrough();
  const toWorker = new PassThrough();
  const network = vi.fn(async (request: { url: string }) => ({
    status: 200,
    body: Buffer.from(
      request.url.endsWith('/api/csrf') ? '{}' : '{"cart":{"items":1}}'
    ),
    cookies: request.url.endsWith('/api/csrf')
      ? [`__Host-csrf-token=${'x'.repeat(43)}; Path=/; Secure`]
      : [],
  }));
  const session = createPublicCartSession({
    origin: 'https://shop.example.com',
    merchantSlug: 'synthetic',
    merchantId: '10000000-0000-4000-8000-000000000001',
    productId: '20000000-0000-4000-8000-000000000002',
    network,
  });
  const host = runPublicCartChannel({
    input: toHost,
    output: toWorker,
    session,
  });
  const worker = createPublicCartWorkerClient({
    input: toWorker,
    output: toHost,
  });
  try {
    await installPublicCartBrowserRoutes({
      context,
      origin: 'https://shop.example.com',
      cart: worker.request,
      resources: [
        {
          url: 'https://shop.example.com/',
          mime: 'text/html',
          bytes: Buffer.from('<h1>Synthetic</h1>'),
          headers: {},
        },
      ],
    });
    const page = await context.newPage();
    await page.goto('https://shop.example.com/');
    await expect(
      page.evaluate(() =>
        fetch('/api/storefront/cart').then((response) => response.json())
      )
    ).resolves.toEqual({ cart: { items: 1 } });
    await worker.finish({ status: 'synthetic' });
    await expect(host).resolves.toEqual({ status: 'synthetic' });
    expect(network).toHaveBeenCalledTimes(2);
  } finally {
    await context.close();
    await browser.close();
  }
}, 30000);

it('serializes concurrent browser requests before using the single-flight host channel', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const toHost = new PassThrough();
  const toWorker = new PassThrough();
  const session = vi.fn(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
    return { status: 200, body: '{"ok":true}' };
  });
  const host = runPublicCartChannel({
    input: toHost,
    output: toWorker,
    session,
  });
  const worker = createPublicCartWorkerClient({
    input: toWorker,
    output: toHost,
  });
  try {
    await installPublicCartBrowserRoutes({
      context,
      origin: 'https://shop.example.com',
      cart: worker.request,
      resources: [
        {
          url: 'https://shop.example.com/',
          mime: 'text/html',
          bytes: Buffer.from('<h1>Synthetic</h1>'),
          headers: {},
        },
      ],
    });
    const page = await context.newPage();
    await page.goto('https://shop.example.com/');
    await expect(
      page.evaluate(async () =>
        Promise.all([
          fetch('/api/storefront/cart').then((r) => r.json()),
          fetch('/api/storefront/experience/state').then((r) => r.json()),
          fetch('/api/storefront/cart/continuity').then((r) => r.json()),
        ])
      )
    ).resolves.toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    await worker.finish({ status: 'synthetic' });
    await expect(host).resolves.toEqual({ status: 'synthetic' });
    expect(session).toHaveBeenCalledTimes(4);
  } finally {
    await context.close();
    await browser.close();
  }
}, 30000);

it('fails closed after a host relay failure', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const cart = vi.fn(async (request: { url: string }) => {
    if (request.url.endsWith('/api/csrf')) return { status: 200, body: '{}' };
    throw Error('host unavailable');
  });
  try {
    await installPublicCartBrowserRoutes({
      context,
      origin: 'https://shop.example.com',
      cart,
      resources: [
        {
          url: 'https://shop.example.com/',
          mime: 'text/html',
          bytes: Buffer.from('<h1>Synthetic</h1>'),
          headers: {},
        },
      ],
    });
    const page = await context.newPage();
    await page.goto('https://shop.example.com/');
    const outcomes = await page.evaluate(async () => {
      const first = await fetch('/api/storefront/cart').then(
        () => true,
        () => false
      );
      const second = await fetch('/api/storefront/cart/continuity').then(
        () => true,
        () => false
      );
      return [first, second];
    });
    expect(outcomes).toEqual([false, false]);
    expect(cart).toHaveBeenCalledTimes(2);
  } finally {
    await context.close();
    await browser.close();
  }
}, 30000);
