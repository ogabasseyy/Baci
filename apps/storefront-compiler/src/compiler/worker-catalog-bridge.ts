import { buildProductCanonicalPathSnippet } from './product-canonical-path-snippet';
import { buildRouteCatalogLoaderSnippet } from './route-catalog-loader-snippet';
import { buildSsrCatalogProjectionSnippet } from './ssr-catalog-projection';

export function buildWorkerCatalogBridgeSnippet(): string {
  return `
function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function isNonNegativeSafeInt(v) {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

function isNonEmptyStr(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isValidAvailabilityFields(obj, requireExplicit) {
  if (obj.available !== undefined && typeof obj.available !== 'boolean') return false;
  if (obj.inStock !== undefined && typeof obj.inStock !== 'boolean') return false;
  if (obj.available !== undefined && obj.inStock !== undefined && obj.available !== obj.inStock) return false;
  return !requireExplicit || typeof obj.available === 'boolean' || typeof obj.inStock === 'boolean';
}

function isNonNegativePrice(v) {
  return isFiniteNumber(v) && v >= 0;
}

function isValidPriceFields(obj) {
  if (obj.priceNgn !== undefined && !isNonNegativePrice(obj.priceNgn)) return false;
  if (obj.price !== undefined && !isNonNegativePrice(obj.price)) return false;
  if (obj.priceNgn !== undefined && obj.price !== undefined && obj.priceNgn !== obj.price) return false;
  return isNonNegativePrice(obj.priceNgn) || isNonNegativePrice(obj.price);
}

function isValidCatalogVariantRecord(v) {
  return (
    v !== null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    isNonEmptyStr(v.id) &&
    isNonEmptyStr(v.label) &&
    isValidPriceFields(v) &&
    isValidAvailabilityFields(v, true)
  );
}

const MAX_CATALOG_PRODUCTS = 48;
const MAX_PRODUCT_VARIANTS = 100;
const MAX_FACET_BUCKETS = 100;

function isValidCatalogProductRecord(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
  if (!isNonEmptyStr(p.id) || !isNonEmptyStr(p.slug) || !isNonEmptyStr(p.name)) {
    return false;
  }
  if (!isValidPriceFields(p)) return false;
  if (p.currency !== undefined && (typeof p.currency !== 'string' || !/^[A-Z]{3}$/.test(p.currency))) {
    return false;
  }
  if (
    !Array.isArray(p.variants) ||
    p.variants.length > MAX_PRODUCT_VARIANTS ||
    !p.variants.every(isValidCatalogVariantRecord)
  ) {
    return false;
  }
  if (!isValidAvailabilityFields(p, false)) {
    return false;
  }
  if ((p.has_variants === true || p.requiresVariant === true) && p.variants.length === 0) {
    return false;
  }
  return true;
}

${buildSsrCatalogProjectionSnippet()}

function isValidFacetsBucket(list) {
  return (
    Array.isArray(list) &&
    list.length <= MAX_FACET_BUCKETS &&
    list.every(
      (b) =>
        b !== null &&
        typeof b === 'object' &&
        !Array.isArray(b) &&
        typeof b.value === 'string' &&
        b.value.length <= 200 &&
        isNonNegativeSafeInt(b.count)
    )
  );
}

function isValidCatalogPayload(data, kind) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (kind === 'product') {
    if (!('product' in data)) return false;
    return data.product === null || isValidCatalogProductRecord(data.product);
  }
  if (kind === 'collection' && typeof data.categoryExists !== 'boolean') {
    return false;
  }
  if (data.title !== undefined && (typeof data.title !== 'string' || data.title.length > 300)) {
    return false;
  }
  if (
    !Array.isArray(data.products) ||
    data.products.length > MAX_CATALOG_PRODUCTS ||
    !data.products.every(isValidCatalogProductRecord)
  ) {
    return false;
  }
  if (data.facets !== undefined) {
    const f = data.facets;
    if (
      !f ||
      typeof f !== 'object' ||
      Array.isArray(f) ||
      !isValidFacetsBucket(f.brands) ||
      !isValidFacetsBucket(f.conditions) ||
      !isNonNegativeSafeInt(f.totalMatches)
    ) {
      return false;
    }
  }
  return true;
}

${buildProductCanonicalPathSnippet()}
${buildRouteCatalogLoaderSnippet()}

function isDeclaredStaticAssetId(id, baseAssets) {
  const map = baseAssets || (typeof ASSETS_MAP === 'object' && ASSETS_MAP !== null ? ASSETS_MAP : null);
  return Boolean(map && typeof id === 'string' && Object.prototype.hasOwnProperty.call(map, id));
}

function collectCatalogAssetUrls(baseAssets, list, single) {
  const merged = { ...baseAssets };
  const rows = Array.isArray(list) ? (single ? [...list, single] : list) : single ? [single] : [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r && typeof r === 'object' && typeof r.imageUrl === 'string' && r.imageUrl.length > 0) {
      const rawAid =
        r.image && typeof r.image === 'object' && typeof r.image.assetId === 'string' && r.image.assetId.length > 0
          ? r.image.assetId
          : '';
      const aid =
        rawAid && !isDeclaredStaticAssetId(rawAid, baseAssets)
          ? rawAid
          : \`catalog-product-\${String(r.id || r.slug || i)}\`;
      if (!isDeclaredStaticAssetId(aid, baseAssets)) merged[aid] = r.imageUrl;
    }
  }
  return merged;
}

function toSdkPublicProduct(p, assetOut) {
  if (!isValidCatalogProductRecord(p)) return null;
  const rawVars = p.variants;
  const variants = rawVars.map((v) => ({
    id: v.id,
    label: v.label,
    available: typeof v.available === 'boolean' ? v.available : Boolean(v.inStock),
    ...(isFiniteNumber(v.price) ? { price: v.price } : isFiniteNumber(v.priceNgn) ? { price: v.priceNgn } : {}),
  }));
  const available =
    typeof p.available === 'boolean'
      ? p.available
      : typeof p.inStock === 'boolean'
        ? p.inStock
        : variants.some((v) => v.available);
  let image = null;
  const rawImgAid =
    p.image && typeof p.image === 'object' && !Array.isArray(p.image) && typeof p.image.assetId === 'string' && p.image.assetId.length > 0
      ? p.image.assetId
      : '';
  const hasImgUrl = typeof p.imageUrl === 'string' && p.imageUrl.length > 0;
  if (rawImgAid && !(hasImgUrl && isDeclaredStaticAssetId(rawImgAid, null))) {
    image = { assetId: rawImgAid, alt: typeof p.image.alt === 'string' && p.image.alt.length > 0 ? p.image.alt : p.name };
    if (assetOut && hasImgUrl && !isDeclaredStaticAssetId(rawImgAid, null)) assetOut[rawImgAid] = p.imageUrl;
  } else if (hasImgUrl) {
    const assetId = \`catalog-product-\${String(p.id || p.slug || 'item')}\`;
    if (assetOut && !isDeclaredStaticAssetId(assetId, null)) assetOut[assetId] = p.imageUrl;
    const altText =
      p.image && typeof p.image === 'object' && typeof p.image.alt === 'string' && p.image.alt.length > 0
        ? p.image.alt
        : typeof p.imageAlt === 'string' && p.imageAlt.length > 0
          ? p.imageAlt
          : p.name;
    image = { assetId, alt: altText };
  }
  return {
    id: String(p.id ?? ''),
    slug: p.slug,
    name: p.name,
    price: isFiniteNumber(p.price) ? p.price : Number(p.priceNgn || 0),
    currency: typeof p.currency === 'string' ? p.currency : 'NGN',
    canonicalPath: resolveProductCanonicalPath(p),
    available,
    requiresVariant: typeof p.requiresVariant === 'boolean' ? p.requiresVariant : Boolean(p.has_variants) || variants.length > 0,
    image,
    variants,
  };
}

function requestMethodForbidden(method) {
  return method !== 'GET' && method !== 'HEAD';
}

function jsonCatalogBridgeResponse(httpStatus, payload, method) {
  return new Response(method === 'HEAD' ? null : JSON.stringify(payload), {
    status: httpStatus,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'content-security-policy': CSP_HEADER,
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}

async function handleCatalogBridgeRequest(url, method) {
  if (requestMethodForbidden(method)) {
    return jsonCatalogBridgeResponse(405, { status: 'error', code: 'INVALID_REQUEST', message: 'Method not allowed' }, method);
  }
  const op = url.searchParams.get('op');
  if (op === 'route') {
    const rawPath = (url.searchParams.get('path') || '').trim();
    if (!rawPath.startsWith('/') || rawPath.startsWith('//') || /[\\\\\\u0000-\\u001f\\u007f]/.test(rawPath)) {
      return jsonCatalogBridgeResponse(400, { status: 'error', code: 'INVALID_REQUEST', message: 'Valid route path is required' }, method);
    }
    const parsedTarget = new URL(rawPath, 'https://storefront.baci.internal');
    if (parsedTarget.origin !== 'https://storefront.baci.internal' || parsedTarget.pathname.startsWith('/_baci')) {
      return jsonCatalogBridgeResponse(400, { status: 'error', code: 'INVALID_REQUEST', message: 'Invalid route path' }, method);
    }
    const matched = matchDeclaredRoute(parsedTarget.pathname);
    if (matched && matched.view === 'bad_request') {
      return jsonCatalogBridgeResponse(400, { status: 'error', code: 'INVALID_REQUEST', message: 'Malformed route path' }, method);
    }
    const routeData = await loadDeclaredRouteCatalog(matched, parsedTarget.searchParams);
    if (routeData.status >= 500) {
      return jsonCatalogBridgeResponse(502, { status: 'error', code: 'SNAPSHOT_STALE', message: routeData.title }, method);
    }
    const extraAssets = collectCatalogAssetUrls({}, routeData.products, routeData.productDetail);
    return jsonCatalogBridgeResponse(200, { status: 'ok', value: { ...routeData, pathname: parsedTarget.pathname }, assets: extraAssets }, method);
  }
  if (op === 'collection') {
    const handle = (url.searchParams.get('handle') || '').trim();
    if (!handle) return jsonCatalogBridgeResponse(400, { status: 'error', code: 'INVALID_REQUEST', message: 'Collection handle is required' }, method);
    const up = await fetchCatalogJson(\`https://catalog.baci.internal/v1/search?category=\${encodeURIComponent(handle)}\`, 'collection');
    if (!up.ok) return jsonCatalogBridgeResponse(502, { status: 'error', code: 'SNAPSHOT_STALE', message: 'Catalog temporarily unavailable' }, method);
    if (!up.data.categoryExists) return jsonCatalogBridgeResponse(404, { status: 'error', code: 'NOT_FOUND', message: 'Collection not found' }, method);
    const assets = {};
    const mapped = (up.data.products || []).map((row) => toSdkPublicProduct(row, assets));
    if (mapped.some((m) => m === null)) return jsonCatalogBridgeResponse(502, { status: 'error', code: 'SNAPSHOT_STALE', message: 'Malformed catalog product record' }, method);
    const gen = up.data.generation;
    const availGen = up.data.availabilityGeneration;
    const revision = gen != null && availGen != null ? \`\${gen}:\${availGen}\` : String(gen ?? availGen ?? '0');
    return jsonCatalogBridgeResponse(200, { status: 'ok', value: { products: mapped, revision }, assets }, method);
  }
  if (op === 'product') {
    const raw = (url.searchParams.get('handle') || '').trim().replace(/^\\/+|\\/+$/g, '');
    if (!raw) return jsonCatalogBridgeResponse(400, { status: 'error', code: 'INVALID_REQUEST', message: 'Product handle is required' }, method);
    const segs = raw.split('/').filter(Boolean);
    const slug = segs[segs.length - 1] || '';
    const cat = segs.length === 2 ? segs[0] : '';
    const catQ = cat ? \`category=\${encodeURIComponent(cat)}&\` : '';
    const up = await fetchCatalogJson(\`https://catalog.baci.internal/v1/product?\${catQ}productSlug=\${encodeURIComponent(slug)}\`, 'product');
    if (!up.ok) return jsonCatalogBridgeResponse(502, { status: 'error', code: 'SNAPSHOT_STALE', message: 'Product temporarily unavailable' }, method);
    if (!up.data.product) return jsonCatalogBridgeResponse(404, { status: 'error', code: 'NOT_FOUND', message: 'Product not found' }, method);
    const assets = {};
    const mapped = toSdkPublicProduct(up.data.product, assets);
    if (!mapped) return jsonCatalogBridgeResponse(502, { status: 'error', code: 'SNAPSHOT_STALE', message: 'Malformed product record' }, method);
    return jsonCatalogBridgeResponse(200, { status: 'ok', value: mapped, assets }, method);
  }
  if (op === 'variants') {
    const productId = (url.searchParams.get('productId') || '').trim();
    if (!productId) return jsonCatalogBridgeResponse(400, { status: 'error', code: 'INVALID_REQUEST', message: 'Product ID is required' }, method);
    const up = await fetchCatalogJson(\`https://catalog.baci.internal/v1/product?productId=\${encodeURIComponent(productId)}\`, 'product');
    if (!up.ok) return jsonCatalogBridgeResponse(502, { status: 'error', code: 'SNAPSHOT_STALE', message: 'Variants temporarily unavailable' }, method);
    if (!up.data.product) return jsonCatalogBridgeResponse(404, { status: 'error', code: 'NOT_FOUND', message: 'Product not found' }, method);
    const mapped = toSdkPublicProduct(up.data.product, null);
    if (!mapped) return jsonCatalogBridgeResponse(502, { status: 'error', code: 'SNAPSHOT_STALE', message: 'Malformed variant record' }, method);
    return jsonCatalogBridgeResponse(200, { status: 'ok', value: mapped.variants }, method);
  }
  return jsonCatalogBridgeResponse(400, { status: 'error', code: 'INVALID_REQUEST', message: 'Unsupported catalog operation' }, method);
}
`;
}
