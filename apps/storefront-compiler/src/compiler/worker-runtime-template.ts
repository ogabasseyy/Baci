import type { WorkerStorefrontManifest } from '../schemas/worker-manifest';
import { buildContentSecurityPolicyHeader } from './csp-header';

export { buildContentSecurityPolicyHeader };

export function buildWorkerSsrEntrySource(options: {
  manifest: WorkerStorefrontManifest;
  cssAssetPath: string;
  clientAssetPath: string;
}): string {
  const { manifest, cssAssetPath, clientAssetPath } = options;
  const entryImportPath = `./${manifest.entry}`;
  const themeTokensJson = JSON.stringify(manifest.themeTokens);
  const declaredRoutesJson = JSON.stringify(manifest.routes);
  const cspHeaderValue = buildContentSecurityPolicyHeader(manifest);

  return `
import { createElement } from 'react';
import { renderToString } from 'react-dom/server.browser';
import StorefrontApp from ${JSON.stringify(entryImportPath)};

const THEME_TOKENS = ${themeTokensJson};
const DECLARED_ROUTES = ${declaredRoutesJson};
const CSP_HEADER = ${JSON.stringify(cspHeaderValue)};
const EMPTY_FACETS = { brands: [], conditions: [], totalMatches: 0 };

function escapeHtmlAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeJsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\\\u003c')
    .replace(/>/g, '\\\\u003e')
    .replace(/&/g, '\\\\u0026');
}

function resolveMerchantSlug(url, request) {
  const headerSlug = request.headers.get('x-baci-merchant-slug');
  if (headerSlug) return headerSlug;
  const host = url.hostname.toLowerCase();
  if (host.endsWith('.mybaci.store')) {
    return host.slice(0, -'.mybaci.store'.length) || 'store';
  }
  return host.split('.')[0] || 'store';
}

function safeDecodeSegment(raw) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

function matchDeclaredRoute(pathname) {
  const reqSegs = pathname.split('/').filter(Boolean);
  for (const route of DECLARED_ROUTES) {
    const patSegs = route.path.split('/').filter(Boolean);
    if (patSegs.length !== reqSegs.length) continue;
    const params = {};
    let matched = true;
    for (let i = 0; i < patSegs.length; i++) {
      const pat = patSegs[i];
      const seg = reqSegs[i];
      if (pat.startsWith(':') || (pat.startsWith('[') && pat.endsWith(']'))) {
        const decoded = safeDecodeSegment(seg);
        if (decoded === null) return { view: 'bad_request', params: {} };
        params[pat.startsWith(':') ? pat.slice(1) : pat.slice(1, -1)] = decoded;
      } else if (pat !== seg) {
        matched = false;
        break;
      }
    }
    if (matched) return { view: route.view, params };
  }
  return null;
}

async function fetchCatalogJson(endpointUrl) {
  try {
    const res = await fetch(endpointUrl);
    if (!res.ok) return { ok: false, status: res.status };
    const data = await res.json();
    if (!data || typeof data !== 'object') return { ok: false, status: 502 };
    return { ok: true, data };
  } catch {
    return { ok: false, status: 502 };
  }
}

export default {
  async fetch(request) {
    const startedAt = performance.now();
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: {
          Allow: 'GET, HEAD',
          'content-security-policy': CSP_HEADER,
        },
      });
    }

    const url = new URL(request.url);
    const merchantSlug = resolveMerchantSlug(url, request);
    const spoofProbe = url.searchParams.get('__spoof_merchant');
    const spoofSuffix = spoofProbe ? \`&merchantId=\${encodeURIComponent(spoofProbe)}\` : '';

    const matchedRoute = matchDeclaredRoute(url.pathname);
    if (matchedRoute && matchedRoute.view === 'bad_request') {
      return new Response('Bad Request', {
        status: 400,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'content-security-policy': CSP_HEADER,
          'x-robots-tag': 'noindex, nofollow',
        },
      });
    }
    let status = 200;
    let view = matchedRoute ? matchedRoute.view : 'not_found';
    let title = 'Storefront';
    let products = [];
    let facets = EMPTY_FACETS;
    let productDetail = null;

    if (!matchedRoute) {
      status = 404;
      view = 'not_found';
      title = 'Page Not Found';
    } else if (matchedRoute.view === 'home') {
      const upstream = await fetchCatalogJson(\`https://catalog.baci.internal/v1/search?limit=12\${spoofSuffix}\`);
      if (!upstream.ok) {
        status = 502;
        title = 'Catalog Temporarily Unavailable';
      } else {
        title = upstream.data.title || 'Featured Devices';
        products = upstream.data.products || [];
        facets = upstream.data.facets || EMPTY_FACETS;
      }
    } else if (matchedRoute.view === 'search') {
      const passthrough = new URLSearchParams(url.searchParams);
      passthrough.delete('__spoof_merchant');
      const upstream = await fetchCatalogJson(\`https://catalog.baci.internal/v1/search?\${passthrough.toString()}\${spoofSuffix}\`);
      if (!upstream.ok) {
        status = 502;
        title = 'Search Temporarily Unavailable';
      } else {
        title = upstream.data.title || 'Search Catalog';
        products = upstream.data.products || [];
        facets = upstream.data.facets || EMPTY_FACETS;
      }
    } else if (matchedRoute.view === 'cart') {
      title = 'Your Cart';
    } else if (matchedRoute.view === 'editorial') {
      title = matchedRoute.params.slug || matchedRoute.params.page || 'Editorial';
    } else if (matchedRoute.view === 'collection') {
      const categoryParam =
        matchedRoute.params.category ||
        matchedRoute.params.handle ||
        url.pathname.split('/').filter(Boolean)[0] ||
        '';
      const upstream = await fetchCatalogJson(
        \`https://catalog.baci.internal/v1/search?category=\${encodeURIComponent(categoryParam)}\${spoofSuffix}\`
      );
      if (!upstream.ok) {
        status = 502;
        title = 'Category Temporarily Unavailable';
      } else if (!upstream.data.categoryExists) {
        status = 404;
        view = 'not_found';
        title = 'Category Not Found';
      } else {
        title = upstream.data.title || categoryParam;
        products = upstream.data.products || [];
        facets = upstream.data.facets || EMPTY_FACETS;
      }
    } else if (matchedRoute.view === 'product') {
      const productSlug =
        matchedRoute.params.productSlug ||
        matchedRoute.params.slug ||
        matchedRoute.params.handle ||
        url.pathname.split('/').filter(Boolean).pop() ||
        '';
      const categoryQuery = matchedRoute.params.category
        ? \`category=\${encodeURIComponent(matchedRoute.params.category)}&\`
        : '';
      const upstream = await fetchCatalogJson(
        \`https://catalog.baci.internal/v1/product?\${categoryQuery}productSlug=\${encodeURIComponent(productSlug)}\${spoofSuffix}\`
      );
      if (!upstream.ok) {
        status = 502;
        title = 'Product Temporarily Unavailable';
      } else if (!upstream.data.product) {
        status = 404;
        view = 'not_found';
        title = 'Product Not Found';
      } else {
        productDetail = upstream.data.product;
        title = upstream.data.product.name;
      }
    }

    const renderProps = {
      view,
      pathname: url.pathname,
      merchantSlug,
      title,
      products,
      facets,
      productDetail,
    };

    const renderStart = performance.now();
    const appHtml =
      status === 502
        ? \`<main class="storefront-shell min-h-screen p-8 max-w-3xl mx-auto"><h1>\${escapeHtmlAttr(title)}</h1><p>Please try again in a moment.</p></main>\`
        : renderToString(createElement(StorefrontApp, renderProps));
    const renderMs = performance.now() - renderStart;

    const jsonLd =
      status === 200 && view === 'product' && productDetail
        ? {
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: productDetail.name,
            brand: { '@type': 'Brand', name: productDetail.brand },
            offers: {
              '@type': 'Offer',
              priceCurrency: 'NGN',
              price: productDetail.priceNgn,
              availability: productDetail.inStock
                ? 'https://schema.org/InStock'
                : 'https://schema.org/OutOfStock',
            },
          }
        : {
            '@context': 'https://schema.org',
            '@type': view === 'collection' ? 'CollectionPage' : 'WebSite',
            name: title,
            url: url.origin + url.pathname,
          };

    const robotsMeta =
      status !== 200
        ? '<meta name="robots" content="noindex, nofollow" />'
        : '<meta name="robots" content="index, follow" />';

    const html = \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>\${escapeHtmlAttr(title)}</title>
  \${robotsMeta}
  <link rel="stylesheet" href="${cssAssetPath}" />
  <style>:root{--theme-primary:\${escapeHtmlAttr(THEME_TOKENS.primary)};--theme-secondary:\${escapeHtmlAttr(THEME_TOKENS.secondary)};--theme-accent:\${escapeHtmlAttr(THEME_TOKENS.accent)};}</style>
  <script type="application/ld+json">\${escapeJsonForScript(jsonLd)}</script>
</head>
<body>
  <div id="root">\${appHtml}</div>
  <script id="__BACI_STOREFRONT_STATE__" type="application/json">\${escapeJsonForScript(renderProps)}</script>
  <script type="module" src="${clientAssetPath}"></script>
</body>
</html>\`;

    const totalMs = performance.now() - startedAt;
    return new Response(request.method === 'HEAD' ? null : html, {
      status,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': CSP_HEADER,
        'server-timing': \`ssr;dur=\${renderMs.toFixed(2)},total;dur=\${totalMs.toFixed(2)}\`,
      },
    });
  },
};
`;
}

export function buildClientHydrationEntrySource(entryPath: string): string {
  return `
import { createElement } from 'react';
import { hydrateRoot } from 'react-dom/client';
import StorefrontApp from ${JSON.stringify(`./${entryPath}`)};

const rootElement = document.getElementById('root');
const stateScript = document.getElementById('__BACI_STOREFRONT_STATE__');
if (rootElement && stateScript?.textContent) {
  const initialProps = JSON.parse(stateScript.textContent);
  hydrateRoot(rootElement, createElement(StorefrontApp, initialProps));
}
`;
}
