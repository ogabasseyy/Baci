import type { WorkerStorefrontManifest } from '../schemas/worker-manifest';

export function buildWorkerSsrEntrySource(options: {
  manifest: WorkerStorefrontManifest;
  cssAssetPath: string;
  clientAssetPath: string;
}): string {
  const { manifest, cssAssetPath, clientAssetPath } = options;
  const entryImportPath = `./${manifest.entry}`;
  const themeTokensJson = JSON.stringify(manifest.themeTokens);
  const declaredRoutesJson = JSON.stringify(manifest.routes);

  return `
import { createElement } from 'react';
import { renderToString } from 'react-dom/server.browser';
import StorefrontApp from ${JSON.stringify(entryImportPath)};

const THEME_TOKENS = ${themeTokensJson};
const DECLARED_ROUTES = ${declaredRoutesJson};

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

const EMPTY_FACETS = { brands: [], conditions: [], totalMatches: 0 };

export default {
  async fetch(request) {
    const startedAt = performance.now();
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { Allow: 'GET, HEAD' },
      });
    }

    const url = new URL(request.url);
    const segments = url.pathname.split('/').filter(Boolean);
    const merchantSlug = resolveMerchantSlug(url, request);
    const spoofProbe = url.searchParams.get('__spoof_merchant');
    const spoofSuffix = spoofProbe ? \`&merchantId=\${encodeURIComponent(spoofProbe)}\` : '';

    let status = 200;
    let view = 'home';
    let title = 'Storefront';
    let products = [];
    let facets = EMPTY_FACETS;
    let productDetail = null;

    if (segments.length === 0) {
      view = 'home';
      const res = await fetch(\`https://catalog.baci.internal/v1/search?limit=12\${spoofSuffix}\`);
      const data = await res.json();
      title = data.title || 'Featured Devices';
      products = data.products || [];
      facets = data.facets || EMPTY_FACETS;
    } else if (segments.length === 1 && segments[0] === 'search') {
      view = 'search';
      const passthrough = new URLSearchParams(url.searchParams);
      passthrough.delete('__spoof_merchant');
      const res = await fetch(\`https://catalog.baci.internal/v1/search?\${passthrough.toString()}\${spoofSuffix}\`);
      const data = await res.json();
      title = data.title || 'Search Catalog';
      products = data.products || [];
      facets = data.facets || EMPTY_FACETS;
    } else if (segments.length === 1 && segments[0] === 'cart') {
      const claimsCart = DECLARED_ROUTES.some((r) => r.path === '/cart');
      if (!claimsCart) {
        status = 404;
        view = 'not_found';
        title = 'Not Found';
      } else {
        view = 'cart';
        title = 'Your Cart';
      }
    } else if (
      segments.length === 2 &&
      (segments[0] === 'products' || segments[0] === 'product')
    ) {
      view = 'product';
      const res = await fetch(
        \`https://catalog.baci.internal/v1/product?productSlug=\${encodeURIComponent(segments[1])}\${spoofSuffix}\`
      );
      const data = await res.json();
      if (!data.product) {
        status = 404;
        view = 'not_found';
        title = 'Product Not Found';
      } else {
        productDetail = data.product;
        title = data.product.name;
      }
    } else if (segments.length === 1) {
      view = 'collection';
      const res = await fetch(
        \`https://catalog.baci.internal/v1/search?category=\${encodeURIComponent(segments[0])}\${spoofSuffix}\`
      );
      const data = await res.json();
      if (!data.categoryExists) {
        status = 404;
        view = 'not_found';
        title = 'Category Not Found';
      } else {
        title = data.title || segments[0];
        products = data.products || [];
        facets = data.facets || EMPTY_FACETS;
      }
    } else if (segments.length === 2) {
      view = 'product';
      const res = await fetch(
        \`https://catalog.baci.internal/v1/product?category=\${encodeURIComponent(segments[0])}&productSlug=\${encodeURIComponent(segments[1])}\${spoofSuffix}\`
      );
      const data = await res.json();
      if (!data.product) {
        status = 404;
        view = 'not_found';
        title = 'Product Not Found';
      } else {
        productDetail = data.product;
        title = data.product.name;
      }
    } else {
      status = 404;
      view = 'not_found';
      title = 'Page Not Found';
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
    const appHtml = renderToString(createElement(StorefrontApp, renderProps));
    const renderMs = performance.now() - renderStart;

    const jsonLd =
      view === 'product' && productDetail
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
      status === 404
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
