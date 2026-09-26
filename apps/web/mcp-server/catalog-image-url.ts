import { normalizeOgabasseyCdnImageUrl } from '../src/lib/ogabassey-cdn-image-url';

/** Resolve public catalog images through the MCP proxy for ChatGPT widgets. */
export function createCatalogImageUrlResolver(publicOrigin: string) {
  return (imageUrl: string | null | undefined): string | undefined => {
    if (typeof imageUrl !== 'string' || !imageUrl) return undefined;

    let parsed: URL;
    try {
      parsed = new URL(normalizeOgabasseyCdnImageUrl(imageUrl), 'https://cdn.ogabassey.com');
    } catch {
      return undefined;
    }
    if (parsed.origin !== 'https://cdn.ogabassey.com') return undefined;
    if (parsed.pathname.includes('/products/') && !parsed.pathname.includes('/core-assets/products/')) {
      parsed.pathname = parsed.pathname.replace('/products/', '/core-assets/products/');
    }
    if (!parsed.pathname.startsWith('/core-assets/products/')) return undefined;
    return `${publicOrigin}/images${parsed.pathname}${parsed.search}`;
  };
}
