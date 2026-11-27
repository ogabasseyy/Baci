import { buildDeclaredRouteMatcherSnippet } from './route-matcher-snippet';

export function buildClientHydrationEntrySource(
  entryPath: string,
  assetsMap: Readonly<Record<string, string>> = {},
  routes: ReadonlyArray<{ path: string; view: string }> = []
): string {
  return `
import { CommerceProvider, createCommerceClient } from '@baci/experience-sdk';
import { createElement } from 'react';
import { hydrateRoot } from 'react-dom/client';

const ASSETS_MAP = ${JSON.stringify(assetsMap)};
const DECLARED_ROUTES = ${JSON.stringify(routes)};
${buildDeclaredRouteMatcherSnippet()}
const UNSAFE_PATH_CHARS = /[\\\\\\u0000-\\u001f\\u007f]/;
function resolveSafeInternalPath(p) {
  if (typeof p !== 'string' || !p.startsWith('/') || p.startsWith('//') || UNSAFE_PATH_CHARS.test(p)) {
    return null;
  }
  try {
    const resolved = new URL(p, window.location.origin);
    if (resolved.origin !== window.location.origin) return null;
    if (resolved.pathname === '/_baci' || resolved.pathname.startsWith('/_baci/')) return null;
    const normalized = resolved.pathname + resolved.search + resolved.hash;
    if (!normalized.startsWith('/') || normalized.startsWith('//') || UNSAFE_PATH_CHARS.test(normalized)) {
      return null;
    }
    return { normalized, pathname: resolved.pathname };
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
      let routeEpoch = 1;
      let currentRevision =
        typeof initialProps.publicDataRevision === 'string' && initialProps.publicDataRevision.length > 0
          ? initialProps.publicDataRevision
          : '0';
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
          const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
          const timer = ctrl && typeof setTimeout === 'function' ? setTimeout(() => ctrl.abort(), 4000) : null;
          try {
            const ep = new URL(
              \`/_baci/catalog?op=\${op}&\${paramKey}=\${encodeURIComponent(rawVal.trim())}\`,
              window.location.origin
            );
            const res = await fetch(ep.href, ctrl ? { headers: { accept: 'application/json' }, signal: ctrl.signal } : { headers: { accept: 'application/json' } });
            const payload = await res.json();
            if (payload && typeof payload === 'object' && (payload.status === 'ok' || payload.status === 'error')) {
              if (payload.assets && typeof payload.assets === 'object' && !Array.isArray(payload.assets)) {
                for (const [aid, aurl] of Object.entries(payload.assets)) {
                  if (typeof aurl === 'string') runtimeAssets[aid] = aurl;
                }
              }
              if (payload.status === 'ok' && payload.value && typeof payload.value.revision === 'string') {
                currentRevision = payload.value.revision;
              }
              const { assets: _extraAssets, ...bridgeResult } = payload;
              return bridgeResult;
            }
            return { status: 'error', code: 'SNAPSHOT_STALE', message: 'Malformed catalog response' };
          } catch {
            return { status: 'error', code: 'SNAPSHOT_STALE', message: 'Catalog request failed' };
          } finally {
            if (timer !== null && typeof clearTimeout === 'function') clearTimeout(timer);
          }
        }
        if (method === 'navigation.go') {
          const target = resolveSafeInternalPath(args?.path);
          if (!target) {
            return { status: 'error', code: 'INVALID_REQUEST', message: 'Navigation path must be a same-origin relative path' };
          }
          if (RANKED_DECLARED_ROUTES.length > 0) {
            const matched = matchDeclaredRoute(target.pathname);
            if (!matched) {
              return { status: 'error', code: 'NOT_FOUND', message: 'Destination route is not declared' };
            }
            if (matched.view === 'bad_request') {
              return { status: 'error', code: 'INVALID_REQUEST', message: 'Malformed navigation path segment' };
            }
            const nextState = {
              epoch: ++routeEpoch,
              routeId: matched.view,
              params: { ...matched.params },
              canonicalPath: target.normalized,
              publicDataRevision: currentRevision,
            };
            window.location.assign(target.normalized);
            return { status: 'ok', value: nextState };
          }
          const fallbackId = target.pathname === '/' ? 'home' : target.pathname.split('/').filter(Boolean)[0] || 'route';
          const nextState = {
            epoch: ++routeEpoch,
            routeId: fallbackId,
            params: {},
            canonicalPath: target.normalized,
            publicDataRevision: currentRevision,
          };
          window.location.assign(target.normalized);
          return { status: 'ok', value: nextState };
        }
        if (method === 'navigation.open') {
          const target = resolveSafeInternalPath(args?.path);
          if (!target) {
            return { status: 'error', code: 'INVALID_REQUEST', message: 'Navigation path must be a same-origin relative path' };
          }
          const safePath = target.normalized;
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
        if (method === 'checkout.prepare' || method === 'checkout.open') {
          return { status: 'error', code: 'CART_ENROLLMENT_REQUIRED', message: 'Cart session enrollment required before checkout' };
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
