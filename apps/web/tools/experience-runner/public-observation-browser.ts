import { createHash } from 'node:crypto';
import type { Browser } from 'playwright-core';
import {
  productionDeliveryOrigins,
  productionOrigin,
} from '@/lib/experience/production-origins';
import { publicObservationPayload } from '@/schemas/experience-public-observation-payload';
import { installPublicCartBrowserRoutes } from './public-cart-browser-route';
import { createPublicCommerceEvidence } from './public-commerce-evidence';
import { observePublicCommerce } from './public-observation-commerce';
import { observeNativePublicCommerce } from './public-observation-native-commerce';
import {
  MAX_PUBLIC_OBSERVATION_BYTES,
  MAX_PUBLIC_RESOURCE_BYTES,
} from './public-observation-resource-limit';
import { inspectPublicRoutes } from './public-observation-routes';

const hash = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');
type Request = { url: string; method: 'GET' | 'POST'; body?: string };

/** Browser must be in the network-disabled sandbox; this function never grants network access. */
export async function observePublicBrowser(
  input: unknown,
  browser: Browser,
  relay: (request: Request) => Promise<{ status: number; body: string }>
) {
  const payload = publicObservationPayload.parse(input);
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
    if (
      bytes.toString('base64') !== resource.bytes ||
      bytes.length > MAX_PUBLIC_RESOURCE_BYTES
    )
      throw Error('PUBLIC_OBSERVATION_INPUT_INVALID');
    return { ...resource, bytes };
  });
  const unique = new Map(resources.map((item) => [item.url, item]));
  if (
    unique.size !== resources.length ||
    resources.reduce((n, item) => n + item.bytes.length, 0) >
      MAX_PUBLIC_OBSERVATION_BYTES
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
  const entry = routes.find((route) => route.path === '/') ?? routes[0];
  const productPath = expected.product.path;
  const productCanonical = `${origin}${productPath}`;
  const productFrame = routes.find((route) => route.path === productPath);
  if (
    expected.product.native
      ? productFrame || !unique.has(productCanonical)
      : !productFrame
  )
    throw Error('PUBLIC_ROUTE_MISMATCH');
  const evidence = createPublicCommerceEvidence({
    origin,
    merchantId: payload.product.merchantId,
    productId: payload.product.productId,
    variantId: payload.product.variantId,
    paths: expected.product.native
      ? [...routes.map((route) => route.path), productPath]
      : routes.map((route) => route.path),
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
      const response = await page.goto(productCanonical, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      if (response?.status() !== 200 || page.url() !== productCanonical)
        throw Error('PUBLIC_ROUTE_MISMATCH');
      const frame = page.locator('iframe[data-baci-experience-build]');
      if (productFrame) {
        await frame.first().waitFor({ state: 'attached', timeout: 45000 });
        if (
          (await frame.count()) !== 1 ||
          (await frame.getAttribute('data-baci-experience-build')) !==
            expected.buildDigest ||
          (await frame.getAttribute('sandbox')) !== 'allow-scripts' ||
          (await frame.getAttribute('src')) !== productFrame.frameUrl
        )
          throw Error('PUBLIC_FRAME_MISMATCH');
        await page
          .frameLocator('iframe[data-baci-experience-build]')
          .locator('html[data-baci-hydration="ready"]')
          .waitFor({ timeout: 45000 });
        const actualFrame = await (await frame.elementHandle())?.contentFrame();
        if (!actualFrame || actualFrame.url() !== productFrame.frameUrl)
          throw Error('PUBLIC_FRAME_MISMATCH');
      } else {
        const canonical = page.locator('link[rel~="canonical"]');
        if (
          (await frame.count()) !== 0 ||
          (await canonical.count()) !== 1 ||
          (await canonical.getAttribute('href')) !== productCanonical
        )
          throw Error('PUBLIC_ROUTE_MISMATCH');
      }
      armed = true;
      const commerce = productFrame
        ? await observePublicCommerce(page, evidence)
        : await observeNativePublicCommerce(page, expected.product, evidence);
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
          path: entry.path,
          evidenceDigest: hash(JSON.stringify(findRoute(entry.path))),
        },
        {
          action: 'product' as const,
          path: productPath,
          evidenceDigest: productFrame
            ? hash(JSON.stringify(findRoute(productPath)))
            : hash(
                JSON.stringify({
                  path: productPath,
                  title: await page.title(),
                  status: 200,
                })
              ),
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
