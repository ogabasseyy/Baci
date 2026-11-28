import type { WorkerStorefrontManifest } from '../schemas/worker-manifest';
import { buildBoundedCatalogJsonSnippet } from './bounded-json-snippet';
import { buildClientHydrationEntrySource } from './client-hydration-template';
import { buildContentSecurityPolicyHeader } from './csp-header';
import { buildFrameErrorAsset } from './frame-error-script-snippet';
import { buildDeclaredRouteMatcherSnippet } from './route-matcher-snippet';
import { buildWorkerCatalogBridgeSnippet } from './worker-catalog-bridge';

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
  const frameErrorAsset = buildFrameErrorAsset(manifest);
  const canonicalHostOrigin =
    manifest.hostOrigin ?? `https://${manifest.merchantSlug}.usebaci.com`;
  const assetsMapJson = JSON.stringify(
    Object.fromEntries(
      manifest.assets.map((a) => [a.assetId, `/assets/${a.assetId}`])
    )
  );

  return `
import { CommerceProvider, createCommerceClient } from '@baci/experience-sdk';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server.browser';

let cachedStorefrontApp = null;
async function loadStorefrontApp() {
  if (cachedStorefrontApp) return cachedStorefrontApp;
  const mod = await import(${JSON.stringify(entryImportPath)});
  if (!mod || !mod.default) throw new Error('Missing default export');
  cachedStorefrontApp = mod.default;
  return cachedStorefrontApp;
}

const THEME_TOKENS = ${themeTokensJson};
const DECLARED_ROUTES = ${declaredRoutesJson};
const CSP_HEADER = ${JSON.stringify(cspHeaderValue)};
const TRUSTED_MERCHANT_SLUG = ${JSON.stringify(manifest.merchantSlug)};
const CANONICAL_HOST_ORIGIN = ${JSON.stringify(canonicalHostOrigin)};
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

${buildDeclaredRouteMatcherSnippet()}

function formatUpstreamRevision(data) {
  const g = data?.generation;
  const a = data?.availabilityGeneration;
  return g != null && a != null ? \`\${g}:\${a}\` : g != null || a != null ? String(g ?? a) : '0';
}

const CATALOG_FETCH_TIMEOUT_MS = 2500;
${buildBoundedCatalogJsonSnippet()}
async function fetchCatalogJson(endpointUrl, kind) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CATALOG_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(endpointUrl, { signal: ctrl.signal });
    if (!res.ok) return { ok: false, status: res.status };
    const data = await readBoundedCatalogJson(res, MAX_CATALOG_RESPONSE_BYTES);
    if (data === null || !isValidCatalogPayload(data, kind)) return { ok: false, status: 502 };
    return { ok: true, data };
  } catch {
    return { ok: false, status: 502 };
  } finally {
    clearTimeout(timer);
  }
}
${buildWorkerCatalogBridgeSnippet()}
export default {
  async fetch(request) {
    const startedAt = performance.now();
    const url = new URL(request.url);
    if (url.pathname === '/_baci/catalog' && request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, HEAD, OPTIONS', 'access-control-allow-headers': 'accept', 'cache-control': 'no-store' } });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { Allow: 'GET, HEAD', 'content-security-policy': CSP_HEADER },
      });
    }
    if (url.pathname === '${frameErrorAsset.path}') {
      return new Response(request.method === 'HEAD' ? null : ${JSON.stringify(frameErrorAsset.source)}, { status: 200, headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=86400, immutable', 'content-security-policy': CSP_HEADER, 'x-robots-tag': 'noindex, nofollow' } });
    }
    if (url.pathname === '/_baci/catalog') {
      return handleCatalogBridgeRequest(url, request.method);
    }
    if (url.pathname === '/_baci' || url.pathname.startsWith('/_baci/')) {
      return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'content-security-policy': CSP_HEADER, 'x-robots-tag': 'noindex, nofollow' } });
    }
    const merchantSlug = TRUSTED_MERCHANT_SLUG;
    const matchedRoute = matchDeclaredRoute(url.pathname);
    if (matchedRoute && matchedRoute.view === 'bad_request') {
      return new Response('Bad Request', {
        status: 400,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'content-security-policy': CSP_HEADER, 'x-robots-tag': 'noindex, nofollow' },
      });
    }
    const routeData = await loadDeclaredRouteCatalog(matchedRoute, url.searchParams);
    let status = routeData.status;
    let view = routeData.view;
    let title = routeData.title;
    const products = routeData.products;
    const facets = routeData.facets;
    const productDetail = routeData.productDetail;
    const publicDataRevision = routeData.publicDataRevision;

    const renderProps = {
      view, pathname: url.pathname, workerOrigin: url.origin, merchantSlug, title, products, facets, productDetail, publicDataRevision,
    };

    const renderStart = performance.now();
    let appHtml = '';
    if (status === 502) {
      appHtml = \`<main class="storefront-shell min-h-screen p-8 max-w-3xl mx-auto"><h1>\${escapeHtmlAttr(title)}</h1><p>Please try again in a moment.</p></main>\`;
    } else {
      try {
        const StorefrontApp = await loadStorefrontApp();
        const ssrAssets = collectCatalogAssetUrls(ASSETS_MAP, products, productDetail);
        appHtml = renderToString(
          createElement(CommerceProvider, { commerce: SSR_COMMERCE, assets: ssrAssets }, createElement(StorefrontApp, renderProps))
        );
      } catch {
        status = 500;
        view = 'error';
        title = 'Storefront Render Error';
        appHtml = \`<main class="storefront-shell min-h-screen p-8 max-w-3xl mx-auto"><h1>\${escapeHtmlAttr(title)}</h1><p>Something went wrong while rendering this page.</p></main>\`;
      }
    }
    const renderMs = performance.now() - renderStart;

    const pdInStock = productDetail
      ? typeof productDetail.available === 'boolean'
        ? productDetail.available
        : typeof productDetail.inStock === 'boolean'
          ? productDetail.inStock
          : Array.isArray(productDetail.variants) && productDetail.variants.some((v) => (typeof v.available === 'boolean' ? v.available : v.inStock === true))
      : false;
    const jsonLd = status === 200 && view === 'product' && productDetail
      ? { '@context': 'https://schema.org', '@type': 'Product', name: productDetail.name, brand: { '@type': 'Brand', name: productDetail.brand }, offers: { '@type': 'Offer', priceCurrency: productDetail.currency || 'NGN', price: productDetail.priceNgn ?? productDetail.price, availability: pdInStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock' } }
      : { '@context': 'https://schema.org', '@type': view === 'collection' ? 'CollectionPage' : 'WebSite', name: title, url: CANONICAL_HOST_ORIGIN + url.pathname };
    const robotsMeta = status !== 200 ? '<meta name="robots" content="noindex, nofollow" />' : '<meta name="robots" content="index, follow" />';
    const hydrationBootstrap = status >= 500 ? '<script type="module" src="${frameErrorAsset.path}"></script>' : \`<script id="__BACI_STOREFRONT_STATE__" type="application/json">\${escapeJsonForScript(renderProps)}</script>\\n  <script type="module" src="${clientAssetPath}"></script>\`;

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
    const htmlCspHeader = /^https?:\\/\\//i.test(url.origin)
      ? CSP_HEADER.replace(/connect-src ([^;]+)/, \`connect-src $1 \${url.origin}\`)
      : CSP_HEADER;
    return new Response(request.method === 'HEAD' ? null : html, {
      status,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': htmlCspHeader,
        'server-timing': \`ssr;dur=\${renderMs.toFixed(2)},total;dur=\${totalMs.toFixed(2)}\`,
      },
    });
  },
};
`;
}
