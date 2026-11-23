import type { BrowserContext } from 'playwright-core';
import { PUBLIC_ROUTE_TIMEOUT_MS } from './public-observation-deadline';
import { MAX_PUBLIC_OBSERVATION_ROUTES } from './public-observation-resource-limit';

/** Call only in a network-disabled browser with the host-validated routes installed. */
export async function inspectPublicRoutes(settings: {
  context: BrowserContext;
  buildDigest: string;
  routes: {
    path: string;
    canonical: string;
    title: string;
    frameUrl: string;
  }[];
  timeoutMs?: number;
}) {
  if (
    !/^[a-f0-9]{64}$/.test(settings.buildDigest) ||
    !settings.routes.length ||
    settings.routes.length > MAX_PUBLIC_OBSERVATION_ROUTES
  )
    throw Error('PUBLIC_ROUTES_INVALID');
  const page = await settings.context.newPage();
  const observed = [];
  const timeout = settings.timeoutMs ?? PUBLIC_ROUTE_TIMEOUT_MS;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    for (const route of settings.routes) {
      // Close the page when the shared route window expires, even if a later
      // locator operation has its own Playwright timeout.
      let expired = false;
      deadline = setTimeout(() => {
        expired = true;
        void page.close().catch(() => undefined);
      }, timeout);
      const response = await page.goto(route.canonical, {
        waitUntil: 'domcontentloaded',
        timeout,
      });
      if (response?.status() !== 200 || page.url() !== route.canonical)
        throw Error('PUBLIC_ROUTE_MISMATCH');
      const frame = page.locator('iframe[data-baci-experience-build]');
      await frame.first().waitFor({ state: 'attached', timeout });
      if (
        (await frame.count()) !== 1 ||
        (await frame.getAttribute('data-baci-experience-build')) !==
          settings.buildDigest ||
        (await frame.getAttribute('sandbox')) !== 'allow-scripts' ||
        (await frame.getAttribute('src')) !== route.frameUrl
      )
        throw Error('PUBLIC_FRAME_MISMATCH');
      const rendered = page
        .frameLocator('iframe[data-baci-experience-build]')
        .locator('html');
      await rendered.waitFor({ timeout });
      await page
        .frameLocator('iframe[data-baci-experience-build]')
        .locator('html[data-baci-hydration="ready"]')
        .waitFor({ timeout });
      if (
        (await rendered.getAttribute('data-baci-experience-build')) !==
        settings.buildDigest
      )
        throw Error('PUBLIC_FRAME_MISMATCH');
      // The platform shell sets the experience title after hydration.
      await page.waitForFunction(
        (title) => document.title === title,
        route.title,
        {
          timeout,
        }
      );
      const canonical = page.locator('link[rel~="canonical"]');
      if (
        page.url() !== route.canonical ||
        (await canonical.count()) !== 1 ||
        (await canonical.evaluate((link: HTMLLinkElement) => link.href)) !==
          route.canonical
      )
        throw Error('PUBLIC_ROUTE_MISMATCH');
      const actualFrame = await (await frame.elementHandle())?.contentFrame();
      if (expired) throw Error('PUBLIC_ROUTE_TIMEOUT');
      if (!actualFrame || actualFrame.url() !== route.frameUrl)
        throw Error('PUBLIC_FRAME_MISMATCH');
      clearTimeout(deadline);
      observed.push({
        path: route.path,
        canonical: route.canonical,
        title: route.title,
        status: 200 as const,
      });
    }
    return observed;
  } finally {
    clearTimeout(deadline);
    await page.close();
  }
}
