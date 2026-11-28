export function buildRouteEnrichmentSnippet(): string {
  return `
function isDeclaredManifestAsset(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(ASSETS_MAP, id);
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
      const rawAid =
        r.image && typeof r.image === 'object' && typeof r.image.assetId === 'string' && r.image.assetId.length > 0
          ? r.image.assetId
          : '';
      const aid = rawAid && !isDeclaredManifestAsset(rawAid) ? rawAid : \`catalog-product-\${String(r.id || r.slug || i)}\`;
      if (!isDeclaredManifestAsset(aid)) target[aid] = r.imageUrl;
    }
  }
}

function resolveWorkerCatalogOrigin(initialProps) {
  if (typeof initialProps?.workerOrigin === 'string' && /^https?:\\/\\//i.test(initialProps.workerOrigin)) {
    return initialProps.workerOrigin;
  }
  if (typeof document !== 'undefined' && typeof document.baseURI === 'string' && /^https?:\\/\\//i.test(document.baseURI)) {
    try { return new URL(document.baseURI).origin; } catch {}
  }
  if (typeof window !== 'undefined' && typeof window.location?.origin === 'string' && /^https?:\\/\\//i.test(window.location.origin)) {
    return window.location.origin;
  }
  return '';
}

function mergeEnrichedRouteWithLiveBootstrap(enrichedValue, liveBootstrap, assetsTarget, enrichedCache) {
  const baseRows = Array.isArray(enrichedValue.products) ? enrichedValue.products : [];
  const hostRows = Array.isArray(liveBootstrap?.catalog?.products) ? liveBootstrap.catalog.products : null;
  if (enrichedCache) {
    rememberEnrichedProducts(enrichedCache, {
      products: baseRows,
      productDetail: enrichedValue.productDetail ?? null,
    });
  }
  if (!hostRows || hostRows.length === 0) {
    return {
      products: baseRows,
      facets: enrichedValue.facets || buildFacetsFromProducts(baseRows),
      productDetail: enrichedValue.productDetail ?? null,
      title: enrichedValue.title,
    };
  }
  const hostById = new Map();
  const hostBySlug = new Map();
  for (let i = 0; i < hostRows.length; i++) {
    const h = hostRows[i];
    if (h && typeof h === 'object') {
      if (typeof h.id === 'string' && h.id) hostById.set(h.id, h);
      if (typeof h.slug === 'string' && h.slug) hostBySlug.set(h.slug, h);
    }
  }
  const overlayRow = (row) => {
    if (!row || typeof row !== 'object') return row;
    const live = (row.id && hostById.get(row.id)) || (row.slug && hostBySlug.get(row.slug)) || null;
    if (!live) return row;
    return normalizeHostBootstrapProduct(
      { ...row, ...live, priceNgn: typeof live.price === 'number' ? live.price : row.priceNgn, inStock: typeof live.available === 'boolean' ? live.available : row.inStock, brand: row.brand, condition: row.condition, shortSpecs: row.shortSpecs, sku: row.sku, imageUrl: row.imageUrl, imageAlt: row.imageAlt },
      assetsTarget,
      row.categorySlug || '',
      enrichedCache
    );
  };
  const products = baseRows.map(overlayRow);
  const productDetail = enrichedValue.productDetail ? overlayRow(enrichedValue.productDetail) : null;
  return {
    products,
    facets: enrichedValue.facets || buildFacetsFromProducts(products),
    productDetail,
    title: enrichedValue.title,
  };
}

async function fetchWorkerRouteEnrichment(workerOrigin, targetPathname) {
  if (!workerOrigin || typeof fetch !== 'function' || typeof targetPathname !== 'string' || !targetPathname.startsWith('/')) {
    return null;
  }
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl && typeof setTimeout === 'function' ? setTimeout(() => ctrl.abort(), 2500) : null;
  try {
    const ep = \`\${workerOrigin}/_baci/catalog?op=route&path=\${encodeURIComponent(targetPathname)}\`;
    const res = await fetch(ep, ctrl ? { headers: { accept: 'application/json' }, signal: ctrl.signal } : { headers: { accept: 'application/json' } });
    const payload = await res.json();
    if (payload && payload.status === 'ok' && payload.value && typeof payload.value === 'object') {
      return payload;
    }
    return null;
  } catch {
    return null;
  } finally {
    if (timer !== null && typeof clearTimeout === 'function') clearTimeout(timer);
  }
}

function createRouteEnricher(initialProps, runtimeAssets, enrichedCache, getState, applyEnriched) {
  const workerOrigin = resolveWorkerCatalogOrigin(initialProps);
  let enrichedKey = typeof initialProps?.pathname === 'string' && initialProps.pathname.startsWith('/') ? initialProps.pathname : '/';
  let inFlightNav = null;
  const queriesByEpoch = new Map();
  const resolveEpochQuery = (targetPath, targetEpoch) => {
    if (Number.isSafeInteger(targetEpoch) && queriesByEpoch.has(targetEpoch)) {
      const bound = queriesByEpoch.get(targetEpoch);
      return bound && bound.pathname === targetPath ? bound.search : '';
    }
    if (
      inFlightNav &&
      inFlightNav.pathname === targetPath &&
      Number.isSafeInteger(targetEpoch) &&
      targetEpoch > inFlightNav.startEpoch
    ) {
      queriesByEpoch.set(targetEpoch, { pathname: targetPath, search: inFlightNav.search });
      return inFlightNav.search;
    }
    return '';
  };
  const enrich = (targetPath, targetEpoch, liveBootstrap) => {
    const querySuffix = resolveEpochQuery(targetPath, targetEpoch);
    const fullTarget = targetPath + querySuffix;
    const hasUncached =
      Array.isArray(liveBootstrap?.catalog?.products) &&
      liveBootstrap.catalog.products.some((p) => isUncachedNarrowBootstrapRow(p, enrichedCache));
    if (!workerOrigin || typeof fetch !== 'function' || (fullTarget === enrichedKey && !hasUncached)) {
      return false;
    }
    void fetchWorkerRouteEnrichment(workerOrigin, fullTarget).then((payload) => {
      const cur = getState();
      if (!payload || targetEpoch < cur.epoch || cur.props?.pathname !== targetPath) return;
      if (payload.assets && typeof payload.assets === 'object' && !Array.isArray(payload.assets)) {
        for (const [aid, aurl] of Object.entries(payload.assets)) {
          if (typeof aurl === 'string' && !isDeclaredManifestAsset(aid)) runtimeAssets[aid] = aurl;
        }
      }
      const merged = mergeEnrichedRouteWithLiveBootstrap(payload.value, querySuffix ? null : (liveBootstrap || lastHostBootstrap), runtimeAssets, enrichedCache);
      enrichedKey = fullTarget;
      applyEnriched({
        ...cur.props,
        _productsPathname: targetPath,
        view: payload.value.view || cur.props.view,
        title: merged.title || cur.props.title,
        products: merged.products,
        facets: merged.facets,
        productDetail: merged.productDetail,
      });
    });
    return true;
  };
  enrich.createNavHooks = (pathname, search) => ({
    onSend: () => {
      const baseEpoch = Number.isSafeInteger(hostEpoch) ? hostEpoch : Number(getState()?.epoch) || 1;
      const slot = { pathname, search: typeof search === 'string' && search.startsWith('?') ? search : '', startEpoch: baseEpoch };
      inFlightNav = slot;
      return slot;
    },
    onSettle: (slot, res) => {
      if (inFlightNav === slot) inFlightNav = null;
      if (slot && res && res.status === 'ok' && Number.isSafeInteger(res.value?.epoch)) {
        const ep = res.value.epoch;
        queriesByEpoch.set(ep, { pathname: slot.pathname, search: slot.search });
        for (const k of queriesByEpoch.keys()) {
          if (k < ep - 16) queriesByEpoch.delete(k);
        }
      }
    },
  });
  return enrich;
}

function scrollHashFragment(hash) {
  if (!hash || typeof hash !== 'string' || !hash.startsWith('#') || typeof setTimeout !== 'function') return;
  setTimeout(() => {
    try {
      const fid = decodeURIComponent(hash.slice(1));
      if (fid && typeof document !== 'undefined' && typeof document.getElementById === 'function') {
        document.getElementById(fid)?.scrollIntoView?.();
      }
    } catch {}
  }, 0);
}
`;
}
