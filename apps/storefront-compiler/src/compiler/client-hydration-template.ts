import { buildFramedAnchorInterceptorSnippet } from './framed-anchor-snippet';
import { buildHostBootstrapStateSnippet } from './host-bootstrap-state-snippet';
import { buildFramedHostPortSnippet } from './host-port-snippet';
import { buildRouteEnrichmentSnippet } from './route-enrichment-snippet';
import { buildDeclaredRouteMatcherSnippet } from './route-matcher-snippet';

export function buildClientHydrationEntrySource(
  entryPath: string,
  assetsMap: Readonly<Record<string, string>> = {},
  routes: ReadonlyArray<{ path: string; view: string }> = [],
  previewOrigin?: string,
  hostOrigin?: string
): string {
  return `
import { CommerceProvider, createCommerceClient } from '@baci/experience-sdk';
import { createElement, useEffect } from 'react';
import { hydrateRoot } from 'react-dom/client';

const ASSETS_MAP = ${JSON.stringify(assetsMap)};
const DECLARED_ROUTES = ${JSON.stringify(routes)};
${buildDeclaredRouteMatcherSnippet()}
${buildFramedHostPortSnippet(previewOrigin, hostOrigin)}
${buildHostBootstrapStateSnippet()}
${buildRouteEnrichmentSnippet()}
${buildFramedAnchorInterceptorSnippet()}
const UNSAFE_PATH_CHARS = /[\\\\\\u0000-\\u001f\\u007f]/;
function resolveSafeInternalPath(p) {
  if (typeof p !== 'string' || !p.startsWith('/') || p.startsWith('//') || UNSAFE_PATH_CHARS.test(p)) {
    return null;
  }
  try {
    const safeOrigin =
      typeof window.location?.origin === 'string' && /^https?:\\/\\//i.test(window.location.origin)
        ? window.location.origin
        : 'https://storefront.baci.internal';
    const resolved = new URL(p, safeOrigin);
    if (resolved.origin !== safeOrigin) return null;
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
function resolveDeclaredNavigationTarget(rawPath) {
  const target = resolveSafeInternalPath(rawPath);
  if (!target) {
    return { ok: false, error: { status: 'error', code: 'INVALID_REQUEST', message: 'Navigation path must be a same-origin relative path' } };
  }
  if (RANKED_DECLARED_ROUTES.length > 0) {
    const matched = matchDeclaredRoute(target.pathname);
    if (!matched) {
      return { ok: false, error: { status: 'error', code: 'NOT_FOUND', message: 'Destination route is not declared' } };
    }
    if (matched.view === 'bad_request') {
      return { ok: false, error: { status: 'error', code: 'INVALID_REQUEST', message: 'Malformed navigation path segment' } };
    }
    return { ok: true, normalized: target.normalized, routeId: matched.view, params: { ...matched.params } };
  }
  const fallbackId = target.pathname === '/' ? 'home' : target.pathname.split('/').filter(Boolean)[0] || 'route';
  return { ok: true, normalized: target.normalized, routeId: fallbackId, params: {} };
}
const rootElement = document.getElementById('root');
const stateScript = document.getElementById('__BACI_STOREFRONT_STATE__');
if (rootElement && stateScript?.textContent) {
  void (async () => {
    try {
      const initialProps = JSON.parse(stateScript.textContent);
      let currentProps = initialProps;
      const runtimeAssets = { ...ASSETS_MAP };
      const enrichedCatalogCache = new Map();
      seedInitialCatalogAssets(runtimeAssets, initialProps);
      rememberEnrichedProducts(enrichedCatalogCache, initialProps);
      let routeEpoch = 1;
      let currentRevision =
        typeof initialProps.publicDataRevision === 'string' && initialProps.publicDataRevision.length > 0
          ? initialProps.publicDataRevision
          : '0';
      let reactRoot = null;
      let StorefrontApp = null;
      let hydrationCommitted = false;
      let pendingPostCommitRender = false;
      let renderSeq = 0;
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
          if (window.parent && window.parent !== window) {
            const framedCat = await dispatchFramedCatalog(method, paramKey, rawVal.trim(), routeEpoch);
            if (framedCat.status === 'ok' && framedCat.value && typeof framedCat.value.revision === 'string') {
              currentRevision = framedCat.value.revision;
            }
            return framedCat;
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
                  if (typeof aurl === 'string' && !isDeclaredManifestAsset(aid)) runtimeAssets[aid] = aurl;
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
          const resolved = resolveDeclaredNavigationTarget(args?.path);
          if (!resolved.ok) return resolved.error;
          if (window.parent && window.parent !== window) {
            const framedRes = await dispatchFramedNavigation('navigation.go', resolved.normalized, routeEpoch);
            if (framedRes.status === 'ok') {
              if (framedRes.value.epoch > routeEpoch) routeEpoch = framedRes.value.epoch;
              currentRevision = framedRes.value.publicDataRevision;
            }
            return framedRes;
          }
          const nextState = {
            epoch: ++routeEpoch,
            routeId: resolved.routeId,
            params: resolved.params,
            canonicalPath: resolved.normalized,
            publicDataRevision: currentRevision,
          };
          window.location.assign(resolved.normalized);
          return { status: 'ok', value: nextState };
        }
        if (method === 'navigation.open') {
          const resolved = resolveDeclaredNavigationTarget(args?.path);
          if (!resolved.ok) return resolved.error;
          const safePath = resolved.normalized;
          if (window.parent && window.parent !== window) {
            return dispatchFramedNavigation('navigation.open', safePath, routeEpoch);
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
        if (
          window.parent &&
          window.parent !== window &&
          (method === 'checkout.prepare' ||
            method === 'checkout.open' ||
            method === 'cart.readPublic' ||
            method === 'cart.reconcile' ||
            method === 'cart.add' ||
            method === 'cart.remove' ||
            method === 'cart.set_quantity')
        ) {
          return dispatchFramedCartOrCheckout(method, args, routeEpoch);
        }
        if (method === 'checkout.prepare' || method === 'checkout.open') {
          return { status: 'error', code: 'CART_ENROLLMENT_REQUIRED', message: 'Cart session enrollment required before checkout' };
        }
        return { status: 'error', code: 'CART_ENROLLMENT_REQUIRED', message: 'Commerce transport requires active storefront session' };
      });
      function HydrationCommitGate(props) {
        useEffect(() => {
          hydrationCommitted = true;
          if (pendingPostCommitRender) {
            pendingPostCommitRender = false;
            if (reactRoot && typeof reactRoot.render === 'function') {
              reactRoot.render(buildAppTree(currentProps, ++renderSeq, routeEpoch));
              return;
            }
            notifyHostRenderCommitted();
            return;
          }
          notifyHostRenderCommitted(props.renderEpoch);
        }, [props.renderSeq, props.renderEpoch]);
        return props.children;
      }
      const mod = await import(${JSON.stringify(`./${entryPath}`)});
      if (!mod || !mod.default) {
        notifyHostRenderFailed();
        return;
      }
      StorefrontApp = mod.default;
      const buildAppTree = (propsToRender, seq = renderSeq, epochVal = routeEpoch) =>
        createElement(
          CommerceProvider,
          { commerce, assets: runtimeAssets },
          createElement(HydrationCommitGate, { renderSeq: seq, renderEpoch: epochVal }, createElement(StorefrontApp, propsToRender))
        );
      const scheduleHydratedRender = () => {
        if (!hydrationCommitted) {
          pendingPostCommitRender = true;
          return true;
        }
        if (reactRoot && typeof reactRoot.render === 'function') {
          reactRoot.render(buildAppTree(currentProps, ++renderSeq, routeEpoch));
          return true;
        }
        return false;
      };
      reactRoot = hydrateRoot(rootElement, buildAppTree(currentProps, 0, routeEpoch), {
        onUncaughtError: () => notifyHostRenderFailed(),
      });
      const refreshRouteEnrichment = createRouteEnricher(
        initialProps,
        runtimeAssets,
        enrichedCatalogCache,
        () => ({ props: currentProps, epoch: routeEpoch }),
        (nextProps) => {
          currentProps = nextProps;
          scheduleHydratedRender();
        }
      );
      registerHostStateHandlers(
        (bootstrap) => {
          if (!bootstrap || typeof bootstrap !== 'object') return false;
          if (bootstrap.assets && typeof bootstrap.assets === 'object' && !Array.isArray(bootstrap.assets)) {
            for (const [aid, aurl] of Object.entries(bootstrap.assets)) {
              if (typeof aurl === 'string' && !isDeclaredManifestAsset(aid)) runtimeAssets[aid] = aurl;
            }
          }
          if (Number.isSafeInteger(bootstrap.route?.epoch) && bootstrap.route.epoch > routeEpoch) {
            routeEpoch = bootstrap.route.epoch;
          }
          currentProps = {
            ...deriveNextRenderProps(currentProps, bootstrap.route, bootstrap.catalog, runtimeAssets, enrichedCatalogCache),
            bootstrap,
          };
          currentRevision = currentProps.publicDataRevision;
          refreshRouteEnrichment(currentProps.pathname, routeEpoch, bootstrap);
          return scheduleHydratedRender();
        },
        (route) => {
          if (!route || typeof route !== 'object') return;
          if (Number.isSafeInteger(route.epoch) && route.epoch > routeEpoch) {
            routeEpoch = route.epoch;
          }
          currentProps = deriveNextRenderProps(currentProps, route, null, runtimeAssets, enrichedCatalogCache);
          currentRevision = currentProps.publicDataRevision;
          refreshRouteEnrichment(currentProps.pathname, routeEpoch, null);
          scheduleHydratedRender();
        }
      );
      attachFramedNavigationInterceptors(rootElement, commerce, initialProps, () => currentProps?.pathname, refreshRouteEnrichment.rememberPendingQuery);
    } catch (err) {
      notifyHostRenderFailed();
      if (typeof console !== 'undefined' && typeof console.error === 'function') {
        console.error('[baci-storefront] Client hydration error:', err);
      }
    }
  })();
} else {
  notifyHostRenderFailed();
}
`;
}
