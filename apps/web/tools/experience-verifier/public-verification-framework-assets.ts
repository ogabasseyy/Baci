import { JSDOM } from 'jsdom';
import { productionOrigin } from '@/lib/experience/production-origins';
import { createBoundPublicFetcher } from './public-fetch';

/** Fetch only framework assets directly referenced by already-checked pages.
 * Browser-generated URLs and arbitrary same-origin endpoints are never admitted. */
export async function fetchFrameworkAssets(
  canonicalBase: string,
  pages: { canonical: string; bytes: Buffer }[],
  options: Pick<
    Parameters<typeof createBoundPublicFetcher>[0],
    'resolve' | 'network'
  > = {}
) {
  const origin = productionOrigin(canonicalBase);
  if (!pages.length || pages.length > 128) throw Error('INVALID_PUBLIC_PAGES');
  const urls = new Map<string, 'js' | 'css'>();
  for (const page of pages) {
    const canonical = new URL(page.canonical);
    if (
      canonical.origin !== origin ||
      canonical.href !== page.canonical ||
      !Buffer.isBuffer(page.bytes) ||
      page.bytes.length > 2097152
    )
      throw Error('INVALID_PUBLIC_PAGES');
    const html = new TextDecoder('utf-8', { fatal: true }).decode(page.bytes);
    if ((html.match(/</g) ?? []).length > 20000)
      throw Error('INVALID_PUBLIC_PAGES');
    const document = new JSDOM(html);
    try {
      for (const element of document.window.document.querySelectorAll(
        'script[src], link[rel][href]'
      )) {
        const isScript = element.tagName === 'SCRIPT';
        if (
          !isScript &&
          !(element.getAttribute('rel') ?? '')
            .toLowerCase()
            .split(/\s+/)
            .includes('stylesheet')
        )
          continue;
        const raw = element.getAttribute(isScript ? 'src' : 'href') ?? '';
        if (
          raw.includes('%') ||
          raw.includes('\\') ||
          raw.split('/').some((part) => part === '.' || part === '..')
        )
          continue;
        let url: URL;
        try {
          url = new URL(raw, canonical);
        } catch {
          continue;
        }
        const kind = isScript ? 'js' : 'css';
        if (
          url.origin !== origin ||
          url.username ||
          url.password ||
          url.hash ||
          !/^\/_next\/static\/[A-Za-z0-9_./-]+\.(js|css)$/.test(url.pathname) ||
          !url.pathname.endsWith(`.${kind}`) ||
          (url.search !== '' &&
            !/^\?dpl=[A-Za-z0-9_-]{1,128}$/.test(url.search))
        )
          continue;
        urls.set(url.href, kind);
        if (urls.size > 128) throw Error('PUBLIC_ASSET_BUDGET');
      }
    } finally {
      document.window.close();
    }
  }
  if (!urls.size) return [];
  const fetchBound = createBoundPublicFetcher({
    origins: [origin],
    urls: [...urls.keys()],
    ...options,
  });
  const assets = [];
  for (const [url, kind] of urls) {
    const response = await fetchBound(url);
    const mime = response.contentType.split(';', 1)[0].trim().toLowerCase();
    if (
      kind === 'css'
        ? mime !== 'text/css'
        : !['text/javascript', 'application/javascript'].includes(mime)
    )
      throw Error('PUBLIC_FRAMEWORK_ASSET_MISMATCH');
    assets.push({
      url,
      mime,
      bytes: response.body,
      headers: response.securityHeaders,
    });
  }
  return assets;
}
