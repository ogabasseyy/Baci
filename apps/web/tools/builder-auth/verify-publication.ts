/** A public browser proof checks rendered revision AND content; never owner cookies or bearer headers. */
import type { Browser } from '@playwright/test';
import {
  builderPublicContentDigestSchema,
  builderPublicHomeSchema,
} from '../../src/schemas/builder-public-home';
import { portableHomeSchema } from '../../src/schemas/portable-storefront';
import {
  createSafePublicationFetcher,
  type PublicationFetchOptions,
} from './publication-fetch';
export interface PublicPublicationProbeInput {
  merchantId: string;
  url: string;
  publishedVersion: string;
  contentDigest: string;
  config: unknown;
}
export interface PublicPublicationProbeDependencies {
  launch: () => Promise<Browser>;
  publicDatabase?: Omit<
    NonNullable<PublicationFetchOptions['publicDatabase']>,
    'merchantId'
  >;
  /** Test harness only injects bounded local fixture bytes; production defaults to pinned public egress. */
  fetchPublic?: ReturnType<typeof createSafePublicationFetcher>;
}
export async function verifyPublication(
  input: PublicPublicationProbeInput,
  deps: PublicPublicationProbeDependencies
): Promise<boolean> {
  const url = new URL(input.url);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]\.usebaci\.com$/.test(url.hostname)
  )
    return false;
  if (
    !builderPublicHomeSchema.shape.publishedVersion.safeParse(
      input.publishedVersion
    ).success ||
    !builderPublicContentDigestSchema.safeParse(input.contentDigest).success
  )
    return false;
  const config = portableHomeSchema.safeParse(input.config);
  if (!config.success) return false;
  const fetchPublic =
    deps.fetchPublic ??
    createSafePublicationFetcher({
      signal: AbortSignal.timeout(20000),
      publicDatabase: deps.publicDatabase
        ? { ...deps.publicDatabase, merchantId: input.merchantId }
        : undefined,
    });
  const browser = await deps.launch();
  let context: Awaited<ReturnType<Browser['newContext']>> | undefined;
  let healthy = true;
  try {
    context = await browser.newContext({
      serviceWorkers: 'block',
      acceptDownloads: false,
    });
    await context.route('**/*', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.abort();
        return;
      }
      try {
        await route.fulfill(await fetchPublic(route.request().url()));
      } catch {
        healthy = false;
        await route.abort();
      }
    });
    await context.routeWebSocket('**/*', (socket) => socket.close());
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', () => {
      healthy = false;
    });
    await page.goto(input.url, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    const marker = page.locator(
      `[data-baci-published-version="${input.publishedVersion}"][data-baci-content-digest="${input.contentDigest}"]`
    );
    await marker.waitFor({ state: 'visible' });
    const copy = config.data.content
      .flatMap((block) =>
        block.type === 'Hero'
          ? [block.props.title, block.props.subtitle]
          : block.type === 'Text'
            ? [block.props.title, block.props.content]
            : block.type === 'Button'
              ? [block.props.text]
              : block.type === 'Footer'
                ? [block.props.copyrightText]
                : []
      )
      .filter((text) => text.trim());
    const text = await marker.innerText();
    if (!copy.every((part) => text.includes(part))) return false;
    // Force lazy product images to load in this isolated proof, then wait within the probe budget.
    await marker.locator('img').evaluateAll((nodes) => {
      for (const node of nodes)
        if (node instanceof HTMLImageElement) node.loading = 'eager';
    });
    await page.waitForFunction(
      ({ version, digest }) => {
        const root = document.querySelector(
          `[data-baci-published-version="${version}"][data-baci-content-digest="${digest}"]`
        );
        return (
          root !== null &&
          [...root.querySelectorAll('img')].every(
            (node) => node.complete && node.naturalWidth > 0
          )
        );
      },
      { version: input.publishedVersion, digest: input.contentDigest },
      { timeout: 5000 }
    );
    return healthy;
  } catch {
    return false;
  } finally {
    await context?.close();
    await browser.close();
  }
}
