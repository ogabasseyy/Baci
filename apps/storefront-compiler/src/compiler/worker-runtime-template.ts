import type { WorkerStorefrontManifest } from '../schemas/worker-manifest';
import { buildClientHydrationEntrySource } from './client-hydration-template';
import { buildContentSecurityPolicyHeader } from './csp-header';

export { buildClientHydrationEntrySource, buildContentSecurityPolicyHeader };

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
  const assetsMapJson = JSON.stringify(
    Object.fromEntries(
      manifest.assets.map((a) => [a.assetId, `/assets/${a.assetId}`])
    )
  );

  return `
import { CommerceProvider, createCommerceClient } from '@baci/experience-sdk';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server.browser';
import StorefrontApp from ${JSON.stringify(entryImportPath)};

const THEME_TOKENS = ${themeTokensJson};
const DECLARED_ROUTES = ${declaredRoutesJson};
const CSP_HEADER = ${JSON.stringify(cspHeaderValue)};
const TRUSTED_MERCHANT_SLUG = ${JSON.stringify(manifest.merchantSlug)};
const ASSETS_MAP = ${assetsMapJson};
const SSR_COMMERCE = createCommerceClient(async () => ({ status: 'error', code: 'UNSUPPORTED_BROWSER_API', message: 'SSR' }));
const EMPTY_FACETS = { brands: [], conditions: [], totalMatches: 0 };

function escapeHtmlAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeJsonForScript(value) {
  return JSON.stringify(value).replace(/</g, '\\\\u003c').replace(/>/g, '\\\\u003e').replace(/&/g, '\\\\u0026');
}

const ALLOWED_SEARCH_PARAMS = ['brand', 'category', 'condition', 'limit', 'page', 'q'];

function canonicalizeSearchParams(inputParams) {
  const canonical = new URLSearchParams();
  for (const key of ALLOWED_SEARCH_PARAMS) {
    const value = inputParams.get(key);
    if (value !== null && value !== '') canonical.set(key, value);
  }
  return canonical;
}

function safeDecodeSegment(raw) {
  try { return decodeURIComponent(raw); } catch { return null; }
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
        headers: { Allow: 'GET, HEAD', 'content-security-policy': CSP_HEADER },
      });
    }

    const url = new URL(request.url);
    const merchantSlug = TRUSTED_MERCHANT_SLUG;

    const matchedRoute = matchDeclaredRoute(url.pathname);
    if (matchedRoute && matchedRoute.view === 'bad_request') {
      return new Response('Bad Request', {
        status: 400,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'content-security-policy': CSP_HEADER, 'x-robots-tag': 'noindex, nofollow' },
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
      const upstream = await fetchCatalogJson('https://catalog.baci.internal/v1/search?limit=12');
      if (!upstream.ok) {
        status = 502;
        title = 'Catalog Temporarily Unavailable';
      } else {
        title = upstream.data.title || 'Featured Devices';
        products = upstream.data.products || [];
        facets = upstream.data.facets || EMPTY_FACETS;
      }
    } else if (matchedRoute.view === 'search') {
      const canonical = canonicalizeSearchParams(url.searchParams);
      const qs = canonical.toString();
      const endpoint = qs
        ? \`https://catalog.baci.internal/v1/search?\${qs}\`
        : 'https://catalog.baci.internal/v1/search';
      const upstream = await fetchCatalogJson(endpoint);
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
      const paramValues = Object.values(matchedRoute.params);
      title =
        matchedRoute.params.slug ||
        matchedRoute.params.page ||
        paramValues[0] ||
        'Editorial';
    } else if (matchedRoute.view === 'collection') {
      const paramValues = Object.values(matchedRoute.params);
      const categoryParam =
        matchedRoute.params.category ||
        matchedRoute.params.handle ||
        matchedRoute.params.collectionSlug ||
        matchedRoute.params.slug ||
        paramValues[0] ||
        '';
      const upstream = await fetchCatalogJson(
        \`https://catalog.baci.internal/v1/search?category=\${encodeURIComponent(categoryParam)}\`
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
      const paramValues = Object.values(matchedRoute.params);
      const productSlug =
        matchedRoute.params.productSlug ||
        matchedRoute.params.slug ||
        matchedRoute.params.handle ||
        paramValues[paramValues.length - 1] ||
        '';
      const categoryQuery = matchedRoute.params.category
        ? \`category=\${encodeURIComponent(matchedRoute.params.category)}&\`
        : '';
      const upstream = await fetchCatalogJson(
        \`https://catalog.baci.internal/v1/product?\${categoryQuery}productSlug=\${encodeURIComponent(productSlug)}\`
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
      view, pathname: url.pathname, merchantSlug, title, products, facets, productDetail,
    };

    const renderStart = performance.now();
    let appHtml = '';
    if (status === 502) {
      appHtml = \`<main class="storefront-shell min-h-screen p-8 max-w-3xl mx-auto"><h1>\${escapeHtmlAttr(title)}</h1><p>Please try again in a moment.</p></main>\`;
    } else {
      try {
        appHtml = renderToString(
          createElement(CommerceProvider, { commerce: SSR_COMMERCE, assets: ASSETS_MAP }, createElement(StorefrontApp, renderProps))
        );
      } catch {
        status = 500;
        view = 'error';
        title = 'Storefront Render Error';
        appHtml = \`<main class="storefront-shell min-h-screen p-8 max-w-3xl mx-auto"><h1>\${escapeHtmlAttr(title)}</h1><p>Something went wrong while rendering this page.</p></main>\`;
      }
    }
    const renderMs = performance.now() - renderStart;

    const jsonLd =
      status === 200 && view === 'product' && productDetail
        ? {
            '@context': 'https://schema.org', '@type': 'Product',
            name: productDetail.name,
            brand: { '@type': 'Brand', name: productDetail.brand },
            offers: {
              '@type': 'Offer', priceCurrency: 'NGN', price: productDetail.priceNgn,
              availability: productDetail.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
            },
          }
        : {
            '@context': 'https://schema.org',
            '@type': view === 'collection' ? 'CollectionPage' : 'WebSite',
            name: title, url: url.origin + url.pathname,
          };

    const robotsMeta =
      status !== 200
        ? '<meta name="robots" content="noindex, nofollow" />'
        : '<meta name="robots" content="index, follow" />';

    const hydrationBootstrap =
      status >= 500
        ? ''
        : \`<script id="__BACI_STOREFRONT_STATE__" type="application/json">\${escapeJsonForScript(renderProps)}</script>\\n  <script type="module" src="${clientAssetPath}"></script>\`;

    const html = \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>\${escapeHtmlAttr(title)}</title>
  \${robotsMeta}
  <link rel="stylesheet" href="${cssAssetPath}" />
  <style>:root{--store-primary:\${escapeHtmlAttr(THEME_TOKENS.primary)};--store-secondary:\${escapeHtmlAttr(THEME_TOKENS.secondary)};--store-accent:\${escapeHtmlAttr(THEME_TOKENS.accent)};--theme-primary:\${escapeHtmlAttr(THEME_TOKENS.primary)};--theme-secondary:\${escapeHtmlAttr(THEME_TOKENS.secondary)};--theme-accent:\${escapeHtmlAttr(THEME_TOKENS.accent)};}</style>
  <script type="application/ld+json">\${escapeJsonForScript(jsonLd)}</script>
</head>
<body>
  <div id="root">\${appHtml}</div>
  \${hydrationBootstrap}
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
