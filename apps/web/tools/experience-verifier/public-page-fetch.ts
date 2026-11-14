import { JSDOM } from 'jsdom';
import { digestBytes } from '@/lib/experience/manifest-digest';
import { productionOrigin } from '@/lib/experience/production-origins';
import { normalizeExperiencePath } from '@/lib/experience/route-ownership';
import { createBoundPublicFetcher } from './public-fetch';

type Route = { path: string; canonical: string; title: string };

/** Read the bound public documents without executing merchant scripts or following redirects. */
export async function fetchPublicPages(
  canonicalBase: string,
  routes: Route[],
  options: Pick<
    Parameters<typeof createBoundPublicFetcher>[0],
    'resolve' | 'network'
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
      !route.title ||
      route.title.length > 500 ||
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
    return url.href;
  });
  const fetchBound = createBoundPublicFetcher({
    origins: [origin],
    urls,
    ...options,
  });
  const pages = [];
  for (const route of routes) {
    const response = await fetchBound(route.canonical);
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
      const head = document.window.document.head;
      const titles = head.querySelectorAll('title');
      const links = [...head.querySelectorAll('link')].filter((link) =>
        (link.getAttribute('rel') ?? '')
          .toLowerCase()
          .split(/\s+/)
          .includes('canonical')
      );
      const refresh = [
        ...document.window.document.querySelectorAll('meta'),
      ].some(
        (meta) =>
          (meta.getAttribute('http-equiv') ?? '').trim().toLowerCase() ===
          'refresh'
      );
      if (
        titles.length !== 1 ||
        titles[0].textContent !== route.title ||
        links.length !== 1 ||
        links[0].getAttribute('href') !== route.canonical ||
        refresh ||
        document.window.document.querySelector('base')
      )
        throw Error('PUBLIC_PAGE_MISMATCH');
      pages.push({
        ...route,
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
