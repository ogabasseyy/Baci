import { JSDOM } from 'jsdom';
import { digestBytes } from '@/lib/experience/manifest-digest';
import { productionOrigin } from '@/lib/experience/production-origins';
import { normalizeExperiencePath } from '@/lib/experience/route-ownership';
import { buildStorefrontVariantUrl } from '@/lib/storefront-variant-url';
import { createBoundPublicFetcher } from './public-fetch';

type Route = { path: string; canonical: string } & (
  | { title: string; native?: never; renderedTitle?: true }
  | { native: true; title?: never; checkout?: never; variantId?: string }
  | { native: true; title?: never; checkout: true; variantId?: never }
);

/** Read the bound public documents without executing merchant scripts or following redirects. */
export async function fetchPublicPages(
  canonicalBase: string,
  routes: Route[],
  options: Pick<
    Parameters<typeof createBoundPublicFetcher>[0],
    'resolve' | 'network' | 'signal'
  > = {}
) {
  const origin = productionOrigin(canonicalBase);
  if (!routes.length || routes.length > 128)
    throw Error('INVALID_PUBLIC_ROUTES');
  const seen = new Set<string>();
  const urls = routes.map((route) => {
    const path = normalizeExperiencePath(route.path);
    if (
      path !== route.path ||
      (!route.native && (!route.title || route.title.length > 500)) ||
      (route.native && route.checkout && path !== '/checkout') ||
      seen.has(path)
    )
      throw Error('INVALID_PUBLIC_ROUTES');
    seen.add(path);
    const url = new URL(path, origin);
    if (
      url.origin !== origin ||
      url.href !== route.canonical ||
      url.pathname !== path
    )
      throw Error('INVALID_PUBLIC_ROUTES');
    return route.native && route.variantId
      ? buildStorefrontVariantUrl(url.href, { id: route.variantId })
      : url.href;
  });
  const fetchBound = createBoundPublicFetcher({
    origins: [origin],
    urls,
    ...options,
  });
  const pages = [];
  for (const [index, route] of routes.entries()) {
    const requestUrl = urls[index];
    const response = await fetchBound(requestUrl);
    if (
      response.contentType.split(';', 1)[0].trim().toLowerCase() !== 'text/html'
    )
      throw Error('PUBLIC_PAGE_MISMATCH');
    let document: JSDOM | undefined;
    try {
      const html = new TextDecoder('utf-8', { fatal: true }).decode(
        response.body
      );
      let markup = 0;
      for (const character of html)
        if (character === '<' && ++markup > 20000)
          throw Error('PUBLIC_PAGE_MISMATCH');
      document = new JSDOM(html);
      // Next may stream metadata in the body. Include those nodes while
      // excluding SVG titles that belong to page content rather than metadata.
      const doc = document.window.document;
      const titles = [...doc.querySelectorAll('title')].filter(
        (element) => element.namespaceURI === doc.documentElement.namespaceURI
      );
      const title = titles[0]?.textContent;
      const links = [...doc.querySelectorAll('link')].filter((link) =>
        (link.getAttribute('rel') ?? '')
          .toLowerCase()
          .split(/\s+/)
          .includes('canonical')
      );
      const serverCanonical = links[0]?.getAttribute('href');
      const canonicalMatches =
        serverCanonical === route.canonical ||
        (route.path === '/' && serverCanonical === origin);
      const refresh = [...doc.querySelectorAll('meta')].some(
        (meta) =>
          (meta.getAttribute('http-equiv') ?? '').trim().toLowerCase() ===
          'refresh'
      );
      if (
        titles.length !== 1 ||
        !title?.trim() ||
        title.length > 500 ||
        (!route.native && !route.renderedTitle && title !== route.title) ||
        (links.length === 0
          ? !route.native || !route.checkout
          : links.length !== 1 || !canonicalMatches) ||
        refresh ||
        doc.querySelector('base')
      )
        throw Error('PUBLIC_PAGE_MISMATCH');
      pages.push({
        ...route,
        ...(requestUrl === route.canonical ? {} : { requestUrl }),
        title,
        status: 200 as const,
        digest: digestBytes(response.body),
        bytes: response.body,
        securityHeaders: response.securityHeaders,
      });
    } catch {
      throw Error('PUBLIC_PAGE_MISMATCH');
    } finally {
      document?.window.close();
    }
  }
  return pages;
}
