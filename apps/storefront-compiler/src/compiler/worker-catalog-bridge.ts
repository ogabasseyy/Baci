import { buildSsrCatalogProjectionSnippet } from './ssr-catalog-projection';

export function buildWorkerCatalogBridgeSnippet(): string {
  return `
function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
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

function isValidPriceFields(obj) {
  if (obj.priceNgn !== undefined && !isFiniteNumber(obj.priceNgn)) return false;
  if (obj.price !== undefined && !isFiniteNumber(obj.price)) return false;
  return isFiniteNumber(obj.priceNgn) || isFiniteNumber(obj.price);
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

function isValidCatalogProductRecord(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
  if (!isNonEmptyStr(p.id) || !isNonEmptyStr(p.slug) || !isNonEmptyStr(p.name)) {
    return false;
  }
  if (!isValidPriceFields(p)) return false;
  if (!Array.isArray(p.variants) || !p.variants.every(isValidCatalogVariantRecord)) {
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
    list.every(
      (b) =>
        b !== null &&
        typeof b === 'object' &&
        !Array.isArray(b) &&
        typeof b.value === 'string' &&
        isFiniteNumber(b.count)
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
  if (!Array.isArray(data.products) || !data.products.every(isValidCatalogProductRecord)) {
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
      !isFiniteNumber(f.totalMatches)
    ) {
      return false;
    }
  }
  return true;
}

function resolveProductCanonicalPath(p) {
  if (typeof p.canonicalPath === 'string' && p.canonicalPath.startsWith('/') && !p.canonicalPath.startsWith('//')) {
    return p.canonicalPath;
  }
  const slug = typeof p.slug === 'string' && p.slug.length > 0 ? p.slug : '';
  if (!slug || !Array.isArray(DECLARED_ROUTES)) return undefined;
  const prodRoute = DECLARED_ROUTES.find((r) => r && r.view === 'product' && typeof r.path === 'string');
  if (!prodRoute) return undefined;
  const segs = prodRoute.path.split('/').filter(Boolean);
  const dynIdx = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s.startsWith(':') || (s.startsWith('[') && s.endsWith(']'))) dynIdx.push(i);
  }
  const lastDyn = dynIdx[dynIdx.length - 1];
  const prevDyn = dynIdx[dynIdx.length - 2];
  const lastSeg = lastDyn !== undefined ? segs[lastDyn] : '';
  const lastParam = lastSeg.startsWith(':') ? lastSeg.slice(1) : lastSeg.slice(1, -1);
  const slugIdx = lastParam === 'variant' || lastParam === 'variantId' ? prevDyn : lastDyn;
  const out = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (!s.startsWith(':') && !(s.startsWith('[') && s.endsWith(']'))) {
      out.push(s);
      continue;
    }
    const name = s.startsWith(':') ? s.slice(1) : s.slice(1, -1);
    if (name === 'category' || name === 'categoryId' || name === 'categorySlug' || name === 'collection' || name === 'collectionId' || name === 'collectionSlug') {
      if (typeof p.categorySlug !== 'string' || p.categorySlug.length === 0) return undefined;
      out.push(encodeURIComponent(p.categorySlug));
    } else if (name === 'productId') {
      out.push(encodeURIComponent(typeof p.id === 'string' && p.id.length > 0 ? p.id : slug));
    } else if (name === 'sku') {
      out.push(encodeURIComponent(typeof p.sku === 'string' && p.sku.length > 0 ? p.sku : slug));
    } else if (name === 'variant' || name === 'variantId') {
      const v0 = Array.isArray(p.variants) && p.variants[0] && p.variants[0].id ? String(p.variants[0].id) : '';
      if (!v0) return undefined;
      out.push(encodeURIComponent(v0));
    } else if (name === 'productSlug' || name === 'product' || name === 'itemSlug' || i === slugIdx) {
      out.push(encodeURIComponent(slug));
    } else if (dynIdx.length === 2 && i === dynIdx[0] && typeof p.categorySlug === 'string' && p.categorySlug.length > 0) {
      out.push(encodeURIComponent(p.categorySlug));
    } else {
      return undefined;
    }
  }
  return '/' + out.join('/');
}

function collectCatalogAssetUrls(baseAssets, list, single) {
  const merged = { ...baseAssets };
  const rows = Array.isArray(list) ? (single ? [...list, single] : list) : single ? [single] : [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r && typeof r === 'object' && typeof r.imageUrl === 'string' && r.imageUrl.length > 0) {
      const aid =
        r.image && typeof r.image === 'object' && typeof r.image.assetId === 'string' && r.image.assetId.length > 0
          ? r.image.assetId
          : \`catalog-product-\${String(r.id || r.slug || i)}\`;
      merged[aid] = r.imageUrl;
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
  if (p.image && typeof p.image === 'object' && !Array.isArray(p.image) && typeof p.image.assetId === 'string' && p.image.assetId.length > 0) {
    image = { assetId: p.image.assetId, alt: typeof p.image.alt === 'string' && p.image.alt.length > 0 ? p.image.alt : p.name };
    if (assetOut && typeof p.imageUrl === 'string' && p.imageUrl.length > 0) assetOut[p.image.assetId] = p.imageUrl;
  } else if (typeof p.imageUrl === 'string' && p.imageUrl.length > 0) {
    const assetId = \`catalog-product-\${String(p.id || p.slug || 'item')}\`;
    if (assetOut) assetOut[assetId] = p.imageUrl;
    image = { assetId, alt: typeof p.imageAlt === 'string' && p.imageAlt.length > 0 ? p.imageAlt : p.name };
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

function jsonCatalogBridgeResponse(httpStatus, payload, method) {
  return new Response(method === 'HEAD' ? null : JSON.stringify(payload), {
    status: httpStatus,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': CSP_HEADER,
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}

async function handleCatalogBridgeRequest(url, method) {
  const op = url.searchParams.get('op');
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
