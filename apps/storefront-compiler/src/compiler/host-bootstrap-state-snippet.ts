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

function normalizeHostBootstrapProduct(p, assetsTarget, fallbackCategory) {
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
  const aid = p.image && typeof p.image.assetId === 'string' ? p.image.assetId : '';
  if (typeof p.imageUrl === 'string' && p.imageUrl.length > 0) {
    assetsTarget[aid || \`catalog-product-\${String(p.id || p.slug || 'item')}\`] = p.imageUrl;
  }
  const resolvedImg =
    typeof p.imageUrl === 'string' && p.imageUrl.length > 0
      ? p.imageUrl
      : aid && typeof assetsTarget[aid] === 'string'
        ? assetsTarget[aid]
        : '';
  const canonSegs = typeof p.canonicalPath === 'string' ? p.canonicalPath.split('/').filter(Boolean) : [];
  const categorySlug =
    typeof p.categorySlug === 'string' && p.categorySlug.length > 0
      ? p.categorySlug
      : canonSegs.length >= 2
        ? canonSegs[0]
        : fallbackCategory || 'catalog';
  return {
    id: String(p.id || ''),
    slug: String(p.slug || ''),
    name: String(p.name || ''),
    categorySlug,
    brand: typeof p.brand === 'string' ? p.brand : '',
    condition: typeof p.condition === 'string' ? p.condition : 'New',
    price: basePrice,
    priceNgn: basePrice,
    currency: typeof p.currency === 'string' ? p.currency : 'NGN',
    available: avail,
    inStock: avail,
    imageUrl: resolvedImg,
    imageAlt: typeof p.imageAlt === 'string' ? p.imageAlt : typeof p.image?.alt === 'string' ? p.image.alt : String(p.name || ''),
    shortSpecs: typeof p.shortSpecs === 'string' ? p.shortSpecs : '',
    ...(typeof p.canonicalPath === 'string' ? { canonicalPath: p.canonicalPath } : {}),
    ...(typeof p.requiresVariant === 'boolean' ? { requiresVariant: p.requiresVariant } : {}),
    image: p.image ?? null,
    variants,
  };
}

function deriveNextRenderProps(prevProps, routeObj, catalogObj, assetsTarget) {
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
  const hasCatalog = Array.isArray(catalogObj?.products);
  const products = hasCatalog
    ? catalogObj.products.filter((p) => p && typeof p === 'object').map((p) => normalizeHostBootstrapProduct(p, assetsTarget, fallbackCat))
    : Array.isArray(prevProps.products)
      ? prevProps.products
      : [];
  const facets = hasCatalog ? buildFacetsFromProducts(products) : prevProps.facets;
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
  let title = prevProps.title;
  if (hasCanonical || hasCatalog) {
    if (view === 'product') title = productDetail ? productDetail.name : 'Product Not Found';
    else if (view === 'not_found') title = 'Page Not Found';
    else if (view === 'home') title = 'Featured Devices';
    else if (view === 'search') title = 'Search Catalog';
    else if (view === 'cart') title = 'Your Cart';
    else if (view === 'collection') title = fallbackCat || 'Collection';
    else if (view === 'editorial') title = mergedParams.pageSlug || mergedParams.pageId || mergedParams.page || mergedParams.handle || 'Editorial';
  }
  const publicDataRevision =
    typeof routeObj?.publicDataRevision === 'string' && routeObj.publicDataRevision.length > 0
      ? routeObj.publicDataRevision
      : typeof catalogObj?.revision === 'string' && catalogObj.revision.length > 0
        ? catalogObj.revision
        : prevProps.publicDataRevision || '0';
  return {
    ...prevProps,
    view: view === 'product' && (hasCanonical || hasCatalog) && !productDetail ? 'not_found' : view,
    pathname,
    title,
    products,
    facets,
    productDetail,
    publicDataRevision,
    ...(routeObj ? { route: routeObj } : {}),
  };
}
`;
}
