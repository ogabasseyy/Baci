import type { BrowserContext } from 'playwright-core';
import { productionOrigin } from '@/lib/experience/production-origins';
import { publicFrameworkRequest } from '../experience-verifier/public-framework-request';
import { createPublicProductPolicy } from '../experience-verifier/public-product-policy';

type CartRequest = { url: string; method: 'GET' | 'POST'; body?: string };
type Resource = {
  url: string;
  mime: string;
  bytes: Buffer;
  headers: Record<string, string>;
};

/** Defense in depth: only use inside a network-disabled sandbox with service
 * workers blocked. The host must validate all resources and every cart request. */
export async function installPublicCartBrowserRoutes(settings: {
  context: BrowserContext;
  origin: string;
  resources: Resource[];
  cart(request: CartRequest): Promise<{ status: number; body: string }>;
  observeCommerce?(
    request: CartRequest,
    response: { status: number; body: string },
    pageUrl: string
  ): void;
  observeResource?(url: string): void;
  observeBlocked?(url: string, method: string): void;
  product?: { origin: string; merchantId: string; productId: string };
}) {
  const origin = productionOrigin(settings.origin);
  const product =
    settings.product && createPublicProductPolicy(settings.product);
  if (settings.resources.length < 1 || settings.resources.length > 256)
    throw Error('INVALID_BROWSER_RESOURCES');
  const resources = new Map<string, Resource>();
  for (const resource of settings.resources) {
    const url = new URL(resource.url);
    if (
      url.href !== resource.url ||
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.hash ||
      resources.has(url.href) ||
      !Buffer.isBuffer(resource.bytes) ||
      resource.bytes.length > 2097152
    )
      throw Error('INVALID_BROWSER_RESOURCES');
    resources.set(url.href, resource);
  }
  let pending = 0;
  let failed = false;
  let tail: Promise<void> = Promise.resolve();
  const relay = async (request: CartRequest) => {
    if (failed || pending >= 64)
      throw Error('PUBLIC_BROWSER_RELAY_UNAVAILABLE');
    pending++;
    const operation = tail.then(() => {
      if (failed) throw Error('PUBLIC_BROWSER_RELAY_UNAVAILABLE');
      return settings.cart(request);
    });
    tail = operation.then(
      () => undefined,
      () => {
        failed = true;
      }
    );
    try {
      return await operation;
    } finally {
      pending--;
    }
  };
  await relay({ url: `${origin}/api/csrf`, method: 'GET' });
  await settings.context.addCookies([
    {
      name: '__Host-csrf-token',
      value: 'synthetic-browser-token',
      url: `${origin}/`,
      secure: true,
    },
    {
      name: 'csrf-token',
      value: 'synthetic-browser-token',
      url: `${origin}/`,
      secure: true,
    },
  ]);
  let denied = 0;
  await settings.context.route('**/*', async (route) => {
    const req = route.request();
    const resource = resources.get(req.url());
    if (req.method() === 'GET' && resource) {
      settings.observeResource?.(req.url());
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(resource.headers)) {
        if (
          [
            'content-security-policy',
            'x-frame-options',
            'x-content-type-options',
            'referrer-policy',
            'permissions-policy',
            'cross-origin-opener-policy',
            'cross-origin-embedder-policy',
            'cross-origin-resource-policy',
            'origin-agent-cluster',
            'access-control-allow-origin',
            'access-control-allow-credentials',
          ].includes(name.toLowerCase())
        )
          headers[name] = value;
      }
      await route.fulfill({
        status: 200,
        contentType: resource.mime,
        headers,
        body: resource.bytes,
      });
      return;
    }
    const url = new URL(req.url());
    const frameworkKind = publicFrameworkRequest(origin, {
      url: req.url(),
      method: req.method(),
    });
    if (frameworkKind) {
      try {
        const result = await relay({ url: req.url(), method: 'GET' });
        const value: unknown = JSON.parse(result.body);
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw Error();
        const { mime, bytes } = value as Record<string, unknown>;
        if (
          typeof bytes !== 'string' ||
          typeof mime !== 'string' ||
          (frameworkKind === 'css'
            ? mime !== 'text/css'
            : !['text/javascript', 'application/javascript'].includes(mime))
        )
          throw Error();
        const body = Buffer.from(bytes, 'base64');
        if (body.length > 700000 || body.toString('base64') !== bytes)
          throw Error();
        await route.fulfill({ status: 200, contentType: mime, body });
        return;
      } catch {
        /* The host refuses unauthorized, oversized or malformed responses. */
      }
    }
    if (
      product &&
      req.method() === 'OPTIONS' &&
      product({ url: req.url(), method: 'GET' })
    ) {
      await route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': origin,
          'access-control-allow-methods': 'GET, OPTIONS',
          'access-control-allow-headers':
            'apikey, authorization, content-type, x-client-info, accept-profile, x-supabase-api-version',
          'cache-control': 'no-store',
        },
      });
      return;
    }
    if (product?.({ url: req.url(), method: req.method() })) {
      try {
        const result = await relay({ url: req.url(), method: 'GET' });
        await route.fulfill({
          status: result.status,
          contentType: 'application/json',
          body: result.body,
          headers: {
            'access-control-allow-origin': origin,
            'cache-control': 'no-store',
          },
        });
        return;
      } catch {
        /* The host independently checks the exact projection. */
      }
    }
    const allowedPaths = [
      '/api/csrf',
      '/api/storefront/experience/state',
      '/api/storefront/experience/catalog',
      '/api/storefront/experience/launch',
      '/api/storefront/cart',
      '/api/storefront/cart/continuity',
      '/api/storefront/cart/bootstrap',
      '/api/storefront/cart/commands',
      '/api/storefront/cart/checkout',
    ];
    if (
      url.origin === origin &&
      allowedPaths.includes(url.pathname) &&
      (req.method() === 'GET' || req.method() === 'POST')
    ) {
      try {
        const body = req.postData();
        const request = {
          url: req.url(),
          method: req.method() as 'GET' | 'POST',
          ...(body === null ? {} : { body }),
        };
        const result = await relay(request);
        settings.observeCommerce?.(request, result, req.frame().page().url());
        await route.fulfill({
          status: result.status,
          contentType: 'application/json',
          body: result.body,
          headers: { 'cache-control': 'no-store' },
        });
        return;
      } catch {
        /* Refuse requests the host cannot authorize. */
      }
    }
    denied++;
    settings.observeBlocked?.(req.url(), req.method());
    await route.abort('blockedbyclient');
  });
  return { blocked: () => denied };
}
