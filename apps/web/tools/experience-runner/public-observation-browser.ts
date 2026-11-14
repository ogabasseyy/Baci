import { createHash } from 'node:crypto';
import type { Browser } from 'playwright-core';
import { z } from 'zod';
import {
  productionDeliveryOrigins,
  productionOrigin,
} from '@/lib/experience/production-origins';
import { installPublicCartBrowserRoutes } from './public-cart-browser-route';
import { createPublicCommerceEvidence } from './public-commerce-evidence';
import { observePublicCommerce } from './public-observation-commerce';
import { inspectPublicRoutes } from './public-observation-routes';

const hash = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const routeSchema = z.object({
  path: z.string().max(240),
  title: z.string().min(1).max(500),
  canonical: z.url(),
});
const payloadSchema = z.object({
  version: z.literal(1),
  origin: z.string(),
  product: z.object({
    origin: z.string(),
    merchantId: z.uuid(),
    productId: z.uuid(),
    variantId: z.uuid().optional(),
  }),
  expected: z.object({
    buildDigest: digest,
    scriptDigest: digest,
    styleDigest: digest,
    assets: z.record(z.string(), digest),
    routes: z.array(routeSchema).min(1).max(128),
    product: z.object({
      id: z.uuid(),
      path: z.string().max(240),
      variantId: z.uuid().optional(),
    }),
  }),
  resources: z
    .array(
      z.object({
        url: z.url(),
        mime: z.string().max(128),
        bytes: z.string().max(2796204),
        headers: z.record(z.string(), z.string()),
      })
    )
    .min(1)
    .max(256),
});
type Request = { url: string; method: 'GET' | 'POST'; body?: string };

/** Browser must be in the network-disabled sandbox; this function never grants network access. */
export async function observePublicBrowser(
  input: unknown,
  browser: Browser,
  relay: (request: Request) => Promise<{ status: number; body: string }>
) {
  const payload = payloadSchema.parse(input);
  const origin = productionOrigin(payload.origin);
  const productOrigin = productionOrigin(payload.product.origin);
  const expected = payload.expected;
  if (
    expected.product.id !== payload.product.productId ||
    expected.product.variantId !== payload.product.variantId
  )
    throw Error('PUBLIC_OBSERVATION_INPUT_INVALID');
  const resources = payload.resources.map((resource) => {
    const bytes = Buffer.from(resource.bytes, 'base64');
    if (bytes.toString('base64') !== resource.bytes || bytes.length > 2097152)
      throw Error('PUBLIC_OBSERVATION_INPUT_INVALID');
    return { ...resource, bytes };
  });
  const unique = new Map(resources.map((item) => [item.url, item]));
  if (
    unique.size !== resources.length ||
    resources.reduce((n, item) => n + item.bytes.length, 0) > 5500000
  )
    throw Error('PUBLIC_OBSERVATION_INPUT_INVALID');
  const script = resources.filter(
    (item) =>
      /\/app\.js$/.test(new URL(item.url).pathname) &&
      hash(item.bytes) === expected.scriptDigest
  );
  if (script.length !== 1) throw Error('PUBLIC_OUTPUT_MISMATCH');
  const base = script[0].url.slice(0, -'/app.js'.length);
  const baseUrl = new URL(base);
  productionDeliveryOrigins({
    executionOrigin: baseUrl.origin,
    hostOrigins: [origin],
  });
  if (
    !new RegExp(
      `^/published/[a-z0-9][a-z0-9-]{0,99}/${expected.buildDigest}$`
    ).test(baseUrl.pathname) ||
    baseUrl.search ||
    baseUrl.hash
  )
    throw Error('PUBLIC_OUTPUT_MISMATCH');
  const style = unique.get(`${base}/app.css`);
  if (!style || hash(style.bytes) !== expected.styleDigest)
    throw Error('PUBLIC_OUTPUT_MISMATCH');
  const assets: Record<string, string> = {};
  for (const [id, wanted] of Object.entries(expected.assets)) {
    if (!/^[a-z0-9-]{1,80}$/.test(id)) throw Error('PUBLIC_OUTPUT_MISMATCH');
    const item = unique.get(`${base}/assets/${id}`);
    if (!item || hash(item.bytes) !== wanted)
      throw Error('PUBLIC_OUTPUT_MISMATCH');
    assets[id] = hash(item.bytes);
  }
  const routes = expected.routes.map((route) => {
    if (route.canonical !== `${origin}${route.path}`)
      throw Error('PUBLIC_ROUTE_MISMATCH');
    const frameUrl = `${base}/index.html?path=${encodeURIComponent(route.path)}`;
    if (!unique.has(route.canonical) || !unique.has(frameUrl))
      throw Error('PUBLIC_ROUTE_MISMATCH');
    return { ...route, frameUrl };
  });
  const home = routes.find((route) => route.path === '/');
  const product = routes.find((route) => route.path === expected.product.path);
  if (!home || !product) throw Error('PUBLIC_ROUTE_MISMATCH');
  const evidence = createPublicCommerceEvidence({
    origin,
    merchantId: payload.product.merchantId,
    productId: payload.product.productId,
    variantId: payload.product.variantId,
    paths: routes.map((route) => route.path),
  });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const served = new Set<string>();
  let armed = false;
  let forbidden = 0;
  try {
    await installPublicCartBrowserRoutes({
      context,
      origin,
      resources,
      product: {
        origin: productOrigin,
        merchantId: payload.product.merchantId,
        productId: payload.product.productId,
      },
      cart: relay,
      observeResource: (url) => served.add(url),
      observeCommerce: (request, reply, pageUrl) => {
        if (armed) evidence.observe(request, reply, pageUrl);
      },
      observeBlocked: (url) => {
        if (
          /(?:^|\/)(?:orders?|payments?)(?:\/|$)/i.test(new URL(url).pathname)
        )
          forbidden++;
      },
    });
    const observedRoutes = await inspectPublicRoutes({
      context,
      buildDigest: expected.buildDigest,
      routes,
    });
    const page = await context.newPage();
    try {
      const response = await page.goto(product.canonical, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      if (response?.status() !== 200 || page.url() !== product.canonical)
        throw Error('PUBLIC_ROUTE_MISMATCH');
      const frame = page.locator('iframe[data-baci-experience-build]');
      await frame.first().waitFor({ state: 'attached', timeout: 45000 });
      if (
        (await frame.count()) !== 1 ||
        (await frame.getAttribute('data-baci-experience-build')) !==
          expected.buildDigest ||
        (await frame.getAttribute('sandbox')) !== 'allow-scripts' ||
        (await frame.getAttribute('src')) !== product.frameUrl
      )
        throw Error('PUBLIC_FRAME_MISMATCH');
      await page
        .frameLocator('iframe[data-baci-experience-build]')
        .locator('html[data-baci-hydration="ready"]')
        .waitFor({ timeout: 45000 });
      const actualFrame = await (await frame.elementHandle())?.contentFrame();
      if (!actualFrame || actualFrame.url() !== product.frameUrl)
        throw Error('PUBLIC_FRAME_MISMATCH');
      armed = true;
      const commerce = await observePublicCommerce(page, evidence);
      if (!served.has(script[0].url) || !served.has(style.url) || forbidden)
        throw Error('PUBLIC_OBSERVATION_INCOMPLETE');
      const findRoute = (path: string) => {
        const route = observedRoutes.find((item) => item.path === path);
        if (!route) throw Error('PUBLIC_ROUTE_MISMATCH');
        return route;
      };
      const steps = [
        {
          action: 'navigate' as const,
          path: '/',
          evidenceDigest: hash(JSON.stringify(findRoute('/'))),
        },
        {
          action: 'product' as const,
          path: product.path,
          evidenceDigest: hash(JSON.stringify(findRoute(product.path))),
        },
        ...commerce,
      ];
      const observation = {
        parentBuild: expected.buildDigest,
        frameBuild: expected.buildDigest,
        scriptDigest: hash(script[0].bytes),
        styleDigest: hash(style.bytes),
        routes: observedRoutes,
        journey: { steps, orderRequests: 0, paymentRequests: 0 },
        assets,
      };
      return {
        ...observation,
        evidenceDigest: hash(JSON.stringify(observation)),
      };
    } finally {
      await page.close();
    }
  } finally {
    await context.close();
  }
}
