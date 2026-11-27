export function buildClientHydrationEntrySource(
  entryPath: string,
  assetsMap: Readonly<Record<string, string>> = {}
): string {
  return `
import { CommerceProvider, createCommerceClient } from '@baci/experience-sdk';
import { createElement } from 'react';
import { hydrateRoot } from 'react-dom/client';

const ASSETS_MAP = ${JSON.stringify(assetsMap)};
const UNSAFE_PATH_CHARS = /[\\\\\\u0000-\\u001f\\u007f]/;
function resolveSafeInternalPath(p) {
  if (typeof p !== 'string' || !p.startsWith('/') || p.startsWith('//') || UNSAFE_PATH_CHARS.test(p)) {
    return null;
  }
  try {
    const resolved = new URL(p, window.location.origin);
    if (resolved.origin !== window.location.origin) return null;
    const normalized = resolved.pathname + resolved.search + resolved.hash;
    if (!normalized.startsWith('/') || normalized.startsWith('//') || UNSAFE_PATH_CHARS.test(normalized)) {
      return null;
    }
    return normalized;
  } catch {
    return null;
  }
}
function seedInitialCatalogAssets(target, state) {
  const rows = Array.isArray(state?.products)
    ? state.productDetail
      ? [...state.products, state.productDetail]
      : state.products
    : state?.productDetail
      ? [state.productDetail]
      : [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r && typeof r === 'object' && typeof r.imageUrl === 'string' && r.imageUrl.length > 0) {
      const aid =
        r.image && typeof r.image === 'object' && typeof r.image.assetId === 'string' && r.image.assetId.length > 0
          ? r.image.assetId
          : \`catalog-product-\${String(r.id || r.slug || i)}\`;
      target[aid] = r.imageUrl;
    }
  }
}
const rootElement = document.getElementById('root');
const stateScript = document.getElementById('__BACI_STOREFRONT_STATE__');
if (rootElement && stateScript?.textContent) {
  void (async () => {
    try {
      const initialProps = JSON.parse(stateScript.textContent);
      const runtimeAssets = { ...ASSETS_MAP };
      seedInitialCatalogAssets(runtimeAssets, initialProps);
      const commerce = createCommerceClient(async (method, args) => {
        if (
          method === 'catalog.collection' ||
          method === 'catalog.product' ||
          method === 'catalog.variants'
        ) {
          const paramKey = method === 'catalog.variants' ? 'productId' : 'handle';
          const rawVal = args ? args[paramKey] : undefined;
          if (typeof rawVal !== 'string' || rawVal.trim().length === 0) {
            return { status: 'error', code: 'INVALID_REQUEST', message: \`Catalog \${paramKey} must be a non-empty string\` };
          }
          if (typeof fetch !== 'function') {
            return { status: 'error', code: 'UNSUPPORTED_BROWSER_API', message: 'Catalog fetch unavailable' };
          }
          const op = method.slice('catalog.'.length);
          try {
            const ep = new URL(
              \`/_baci/catalog?op=\${op}&\${paramKey}=\${encodeURIComponent(rawVal.trim())}\`,
              window.location.origin
            );
            const res = await fetch(ep.href, { headers: { accept: 'application/json' } });
            const payload = await res.json();
            if (payload && typeof payload === 'object' && (payload.status === 'ok' || payload.status === 'error')) {
              if (payload.assets && typeof payload.assets === 'object' && !Array.isArray(payload.assets)) {
                for (const [aid, aurl] of Object.entries(payload.assets)) {
                  if (typeof aurl === 'string') runtimeAssets[aid] = aurl;
                }
              }
              const { assets: _extraAssets, ...bridgeResult } = payload;
              return bridgeResult;
            }
            return { status: 'error', code: 'SNAPSHOT_STALE', message: 'Malformed catalog response' };
          } catch {
            return { status: 'error', code: 'SNAPSHOT_STALE', message: 'Catalog request failed' };
          }
        }
        if (method === 'navigation.go') {
          const safePath = resolveSafeInternalPath(args.path);
          if (!safePath) {
            return { status: 'error', code: 'INVALID_REQUEST', message: 'Navigation path must be a same-origin relative path' };
          }
          window.location.assign(safePath);
          return {
            status: 'ok',
            value: {
              epoch: 1,
              routeId: String(initialProps.view || 'route'),
              params: {},
              canonicalPath: safePath,
              publicDataRevision: '0',
            },
          };
        }
        if (method === 'navigation.open') {
          const safePath = resolveSafeInternalPath(args.path);
          if (!safePath) {
            return { status: 'error', code: 'INVALID_REQUEST', message: 'Navigation path must be a same-origin relative path' };
          }
          if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'baci:navigation.open', path: safePath }, 'https://usebaci.com');
            return { status: 'ok', value: { presented: true } };
          }
          if (typeof window.open !== 'function') {
            return { status: 'error', code: 'UNSUPPORTED_BROWSER_API', message: 'New browsing context unavailable' };
          }
          const win = window.open(safePath, '_blank');
          if (win) {
            try { win.opener = null; } catch {}
            return { status: 'ok', value: { presented: true } };
          }
          return { status: 'ok', value: { presented: false } };
        }
        if (method === 'checkout.prepare') {
          return { status: 'error', code: 'CART_ENROLLMENT_REQUIRED', message: 'Cart session enrollment required before checkout preparation' };
        }
        if (method === 'checkout.open') {
          window.location.assign(\`https://\${initialProps.merchantSlug}.usebaci.com/cart\`);
          return { status: 'ok', value: { presented: true } };
        }
        return { status: 'error', code: 'CART_ENROLLMENT_REQUIRED', message: 'Commerce transport requires active storefront session' };
      });
      const mod = await import(${JSON.stringify(`./${entryPath}`)});
      if (!mod || !mod.default) return;
      hydrateRoot(
        rootElement,
        createElement(CommerceProvider, { commerce, assets: runtimeAssets }, createElement(mod.default, initialProps))
      );
    } catch (err) {
      if (typeof console !== 'undefined' && typeof console.error === 'function') {
        console.error('[baci-storefront] Client hydration error:', err);
      }
    }
  })();
}
`;
}
