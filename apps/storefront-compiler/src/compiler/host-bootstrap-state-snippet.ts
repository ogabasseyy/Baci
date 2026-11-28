export function buildHostBootstrapStateSnippet(): string {
  return `
const KNOWN_STOREFRONT_VIEWS = new Set([
  'home',
  'collection',
  'product',
  'search',
  'cart',
  'editorial',
  'not_found',
]);

function hasOwnEnrichedCardFields(p) {
  return (
    (typeof p?.brand === 'string' && p.brand.length > 0) ||
    (typeof p?.condition === 'string' && p.condition.length > 0) ||
    (typeof p?.shortSpecs === 'string' && p.shortSpecs.length > 0)
  );
}

function isUncachedNarrowBootstrapRow(p, cache) {
  if (!p || typeof p !== 'object' || hasOwnEnrichedCardFields(p)) return false;
  const pid = typeof p.id === 'string' && p.id.length > 0 ? 'id:' + p.id : '';
  const pslug = typeof p.slug === 'string' && p.slug.length > 0 ? 'slug:' + p.slug : '';
  const cached = (pid && cache?.get(pid)) || (pslug && cache?.get(pslug)) || null;
  return !hasOwnEnrichedCardFields(cached);
}

function rememberEnrichedProducts(cache, state) {
  const rows = Array.isArray(state?.products)
    ? state.productDetail
      ? [...state.products, state.productDetail]
      : state.products
    : state?.productDetail
      ? [state.productDetail]
      : [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || typeof r !== 'object') continue;
    const prev =
      (typeof r.id === 'string' && cache.get('id:' + r.id)) ||
      (typeof r.slug === 'string' && cache.get('slug:' + r.slug)) ||
      {};
    const merged = {
      brand: typeof r.brand === 'string' && r.brand.length > 0 ? r.brand : prev.brand || '',
      condition: typeof r.condition === 'string' && r.condition.length > 0 ? r.condition : prev.condition || '',
      shortSpecs: typeof r.shortSpecs === 'string' && r.shortSpecs.length > 0 ? r.shortSpecs : prev.shortSpecs || '',
      categorySlug: typeof r.categorySlug === 'string' && r.categorySlug.length > 0 ? r.categorySlug : prev.categorySlug || '',
      imageUrl: typeof r.imageUrl === 'string' && r.imageUrl.length > 0 ? r.imageUrl : prev.imageUrl || '',
      imageAlt: typeof r.imageAlt === 'string' && r.imageAlt.length > 0 ? r.imageAlt : prev.imageAlt || '',
    };
    if (typeof r.id === 'string' && r.id.length > 0) cache.set('id:' + r.id, merged);
    if (typeof r.slug === 'string' && r.slug.length > 0) cache.set('slug:' + r.slug, merged);
  }
}

function extractRoutePathname(canonicalPath, fallbackPath) {
  if (typeof canonicalPath !== 'string' || canonicalPath.length === 0) {
    return typeof fallbackPath === 'string' && fallbackPath.startsWith('/') ? fallbackPath : '/';
  }
  try {
    return new URL(canonicalPath, 'https://storefront.baci.internal').pathname || '/';
  } catch {
    return canonicalPath.startsWith('/') ? canonicalPath.split(/[?#]/)[0] || '/' : '/';
  }
}

function buildFacetsFromProducts(list) {
  const brandCounts = new Map();
  const condCounts = new Map();
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (typeof p.brand === 'string' && p.brand.length > 0) {
      brandCounts.set(p.brand, (brandCounts.get(p.brand) || 0) + 1);
    }
    if (typeof p.condition === 'string' && p.condition.length > 0) {
      condCounts.set(p.condition, (condCounts.get(p.condition) || 0) + 1);
    }
  }
  return {
    brands: Array.from(brandCounts, ([value, count]) => ({ value, count })),
    conditions: Array.from(condCounts, ([value, count]) => ({ value, count })),
    totalMatches: list.length,
  };
}

function normalizeHostBootstrapProduct(p, assetsTarget, fallbackCategory, enrichedCache) {
  const pid = String(p.id || '');
  const pslug = String(p.slug || '');
  const existing = (pid && enrichedCache?.get('id:' + pid)) || (pslug && enrichedCache?.get('slug:' + pslug)) || null;
  const basePrice = typeof p.priceNgn === 'number' ? p.priceNgn : typeof p.price === 'number' ? p.price : 0;
  const rawVars = Array.isArray(p.variants) ? p.variants : [];
  const variants = rawVars.map((v) => {
    const vp = typeof v?.priceNgn === 'number' ? v.priceNgn : typeof v?.price === 'number' ? v.price : basePrice;
    const va = typeof v?.available === 'boolean' ? v.available : Boolean(v?.inStock);
    return { id: String(v?.id || ''), label: String(v?.label || ''), price: vp, priceNgn: vp, available: va, inStock: va };
  });
  const avail =
    typeof p.available === 'boolean'
      ? p.available
      : typeof p.inStock === 'boolean'
        ? p.inStock
        : variants.some((v) => v.available);
  const rawAid = p.image && typeof p.image.assetId === 'string' ? p.image.assetId : '';
  const isDeclared =
    Boolean(rawAid) &&
    typeof ASSETS_MAP === 'object' &&
    ASSETS_MAP !== null &&
    Object.prototype.hasOwnProperty.call(ASSETS_MAP, rawAid);
  const hasImgUrl = typeof p.imageUrl === 'string' && p.imageUrl.length > 0;
  const aid = isDeclared && hasImgUrl ? '' : rawAid;
  const selectedAid = hasImgUrl ? aid || \`catalog-product-\${pid || pslug || 'item'}\` : aid;
  if (hasImgUrl) {
    if (!(typeof ASSETS_MAP === 'object' && ASSETS_MAP !== null && Object.prototype.hasOwnProperty.call(ASSETS_MAP, selectedAid))) {
      assetsTarget[selectedAid] = p.imageUrl;
    }
  }
  const resolvedImg =
    typeof p.imageUrl === 'string' && p.imageUrl.length > 0
      ? p.imageUrl
      : aid && typeof assetsTarget[aid] === 'string'
        ? assetsTarget[aid]
        : existing?.imageUrl || '';
  const canonSegs = typeof p.canonicalPath === 'string' ? p.canonicalPath.split('/').filter(Boolean) : [];
  const categorySlug =
    typeof p.categorySlug === 'string' && p.categorySlug.length > 0
      ? p.categorySlug
      : canonSegs.length >= 2
        ? canonSegs[0]
        : existing?.categorySlug || fallbackCategory || 'catalog';
  return {
    id: pid,
    slug: pslug,
    name: String(p.name || ''),
    categorySlug,
    brand: typeof p.brand === 'string' && p.brand.length > 0 ? p.brand : existing?.brand || '',
    condition: typeof p.condition === 'string' && p.condition.length > 0 ? p.condition : existing?.condition || '',
    price: basePrice,
    priceNgn: basePrice,
    currency: typeof p.currency === 'string' ? p.currency : 'NGN',
    available: avail,
    inStock: avail,
    imageUrl: resolvedImg,
    imageAlt:
      typeof p.imageAlt === 'string' && p.imageAlt.length > 0
        ? p.imageAlt
        : typeof p.image?.alt === 'string' && p.image.alt.length > 0
          ? p.image.alt
          : existing?.imageAlt || String(p.name || ''),
    shortSpecs: typeof p.shortSpecs === 'string' && p.shortSpecs.length > 0 ? p.shortSpecs : existing?.shortSpecs || '',
    ...(typeof p.canonicalPath === 'string' ? { canonicalPath: p.canonicalPath } : {}),
    ...(typeof p.requiresVariant === 'boolean' ? { requiresVariant: p.requiresVariant } : {}),
    image:
      p.image && typeof p.image === 'object' && !Array.isArray(p.image) && selectedAid
        ? { ...p.image, assetId: selectedAid }
        : (p.image ?? null),
    variants,
  };
}

function deriveNextRenderProps(prevProps, routeObj, catalogObj, assetsTarget, enrichedCache) {
  const hasCanonical = typeof routeObj?.canonicalPath === 'string' && routeObj.canonicalPath.length > 0;
  const pathname = hasCanonical ? extractRoutePathname(routeObj.canonicalPath, prevProps.pathname) : prevProps.pathname || '/';
  const matched = hasCanonical && RANKED_DECLARED_ROUTES.length > 0 ? matchDeclaredRoute(pathname) : null;
  const view = hasCanonical
    ? matched && matched.view !== 'bad_request'
      ? matched.view
      : KNOWN_STOREFRONT_VIEWS.has(routeObj?.routeId)
        ? routeObj.routeId
        : RANKED_DECLARED_ROUTES.length > 0
          ? 'not_found'
          : prevProps.view
    : prevProps.view;
  const mergedParams = { ...(matched?.params || {}), ...(routeObj?.params && typeof routeObj.params === 'object' ? routeObj.params : {}) };
  const fallbackCat = mergedParams.category || mergedParams.categorySlug || mergedParams.collection || mergedParams.handle || '';
  const prevList = Array.isArray(prevProps.products) ? prevProps.products : [];
  const prevProductsPath =
    typeof prevProps._productsPathname === 'string' && prevProps._productsPathname.length > 0
      ? prevProps._productsPathname
      : prevProps.pathname || '/';
  const hasCatalog = Array.isArray(catalogObj?.products);
  const rawCatalogRows = hasCatalog ? catalogObj.products.filter((p) => p && typeof p === 'object') : [];
  const keepSsrSubsetOnSameRoute =
    hasCatalog &&
    rawCatalogRows.length > 0 &&
    prevList.length > 0 &&
    pathname === prevProductsPath &&
    view === prevProps.view &&
    rawCatalogRows.some((p) => isUncachedNarrowBootstrapRow(p, enrichedCache));
  let products = prevList;
  let preservedSsrSubset = false;
  if (hasCatalog) {
    if (rawCatalogRows.length === 0) {
      products = [];
    } else if (keepSsrSubsetOnSameRoute) {
      const byId = new Map();
      const bySlug = new Map();
      for (let i = 0; i < rawCatalogRows.length; i++) {
        const row = rawCatalogRows[i];
        if (typeof row.id === 'string' && row.id) byId.set(row.id, row);
        if (typeof row.slug === 'string' && row.slug) bySlug.set(row.slug, row);
      }
      const matchedPrev = [];
      for (let i = 0; i < prevList.length; i++) {
        const prevItem = prevList[i];
        const liveRow = (prevItem?.id && byId.get(prevItem.id)) || (prevItem?.slug && bySlug.get(prevItem.slug)) || null;
        if (liveRow) matchedPrev.push(normalizeHostBootstrapProduct(liveRow, assetsTarget, fallbackCat, enrichedCache));
      }
      if (matchedPrev.length > 0) {
        products = matchedPrev;
        preservedSsrSubset = true;
      } else {
        products = rawCatalogRows.map((p) => normalizeHostBootstrapProduct(p, assetsTarget, fallbackCat, enrichedCache));
      }
    } else {
      products = rawCatalogRows.map((p) => normalizeHostBootstrapProduct(p, assetsTarget, fallbackCat, enrichedCache));
    }
  }
  let facets = prevProps.facets;
  if (catalogObj?.facets && Array.isArray(catalogObj.facets.brands) && Array.isArray(catalogObj.facets.conditions)) {
    facets = catalogObj.facets;
  } else if (hasCatalog) {
    if (products.length === 0) {
      facets = { brands: [], conditions: [], totalMatches: 0 };
    } else if (preservedSsrSubset && products.length === prevList.length && prevProps.facets) {
      facets = prevProps.facets;
    } else {
      const derived = buildFacetsFromProducts(products);
      const sameMembership =
        pathname === prevProductsPath &&
        products.length > 0 &&
        prevList.length === products.length &&
        products.every((p, idx) => (p.id && p.id === prevList[idx]?.id) || (p.slug && p.slug === prevList[idx]?.slug));
      facets =
        sameMembership &&
        derived.brands.length === 0 &&
        derived.conditions.length === 0 &&
        prevProps.facets &&
        (prevProps.facets.brands?.length > 0 || prevProps.facets.conditions?.length > 0)
          ? { ...prevProps.facets, totalMatches: products.length }
          : derived;
    }
  }
  let productDetail = prevProps.productDetail ?? null;
  if (view !== 'product') {
    productDetail = null;
  } else if (hasCanonical || hasCatalog) {
    const wantSlug = mergedParams.productSlug || mergedParams.product || mergedParams.itemSlug || mergedParams.slug || mergedParams.handle || pathname.split('/').filter(Boolean).pop() || '';
    const wantId = mergedParams.productId || '';
    productDetail =
      products.find((p) => (wantSlug && p.slug === wantSlug) || (wantId && p.id === wantId) || p.canonicalPath === pathname) ||
      (products.length === 1 && !wantSlug ? products[0] : null);
  }
  const effectiveView = view === 'product' && (hasCanonical || hasCatalog) && !productDetail ? 'not_found' : view;
  let title = prevProps.title;
  const sameRouteView = pathname === prevProps.pathname && effectiveView === prevProps.view && typeof prevProps.title === 'string' && prevProps.title.length > 0;
  if ((hasCanonical || hasCatalog) && (!sameRouteView || (effectiveView === 'product' && productDetail && prevProps.title !== productDetail.name))) {
    if (effectiveView === 'product') title = productDetail ? productDetail.name : 'Product Not Found';
    else if (effectiveView === 'not_found') title = 'Page Not Found';
    else if (effectiveView === 'home') title = 'Featured Devices';
    else if (effectiveView === 'search') title = 'Search Catalog';
    else if (effectiveView === 'cart') title = 'Your Cart';
    else if (effectiveView === 'collection') title = fallbackCat || 'Collection';
    else if (effectiveView === 'editorial') title = mergedParams.pageSlug || mergedParams.pageId || mergedParams.page || mergedParams.handle || 'Editorial';
  }
  const publicDataRevision =
    typeof routeObj?.publicDataRevision === 'string' && routeObj.publicDataRevision.length > 0
      ? routeObj.publicDataRevision
      : typeof catalogObj?.revision === 'string' && catalogObj.revision.length > 0
        ? catalogObj.revision
        : prevProps.publicDataRevision || '0';
  const nextState = {
    ...prevProps,
    _productsPathname: hasCatalog ? pathname : prevProductsPath,
    view: effectiveView,
    pathname,
    title,
    products,
    facets,
    productDetail,
    publicDataRevision,
    ...(routeObj ? { route: routeObj } : {}),
  };
  if (enrichedCache) rememberEnrichedProducts(enrichedCache, nextState);
  return nextState;
}
`;
}
