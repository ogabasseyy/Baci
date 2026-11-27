export function buildWorkerCatalogBridgeSnippet(): string {
  return `
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
  if (!p || typeof p !== 'object' || Array.isArray(p) || typeof p.name !== 'string') {
    return null;
  }
  if ('variants' in p && p.variants !== undefined && !Array.isArray(p.variants)) {
    return null;
  }
  const rawVars = Array.isArray(p.variants) ? p.variants : [];
  const variants = [];
  for (let i = 0; i < rawVars.length; i++) {
    const v = rawVars[i];
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    variants.push({
      id: String(v.id ?? ''),
      label: String(v.label ?? ''),
      available: typeof v.available === 'boolean' ? v.available : Boolean(v.inStock),
      ...(typeof v.price === 'number'
        ? { price: v.price }
        : typeof v.priceNgn === 'number'
          ? { price: v.priceNgn }
          : {}),
    });
  }
  const available =
    typeof p.available === 'boolean'
      ? p.available
      : typeof p.inStock === 'boolean'
        ? p.inStock
        : variants.some((v) => v.available);
  let image = null;
  if (
    p.image &&
    typeof p.image === 'object' &&
    !Array.isArray(p.image) &&
    typeof p.image.assetId === 'string' &&
    p.image.assetId.length > 0
  ) {
    image = {
      assetId: p.image.assetId,
      alt: typeof p.image.alt === 'string' && p.image.alt.length > 0 ? p.image.alt : p.name,
    };
    if (assetOut && typeof p.imageUrl === 'string' && p.imageUrl.length > 0) {
      assetOut[p.image.assetId] = p.imageUrl;
    }
  } else if (typeof p.imageUrl === 'string' && p.imageUrl.length > 0) {
    const assetId = \`catalog-product-\${String(p.id || p.slug || 'item')}\`;
    if (assetOut) assetOut[assetId] = p.imageUrl;
    image = {
      assetId,
      alt: typeof p.imageAlt === 'string' && p.imageAlt.length > 0 ? p.imageAlt : p.name,
    };
  }
  return {
    id: String(p.id ?? ''),
    slug: String(p.slug ?? ''),
    name: p.name,
    price: typeof p.price === 'number' ? p.price : Number(p.priceNgn || 0),
    currency: typeof p.currency === 'string' ? p.currency : 'NGN',
    canonicalPath:
      p.categorySlug && p.slug
        ? \`/\${p.categorySlug}/\${p.slug}\`
        : p.slug
          ? \`/\${p.slug}\`
          : undefined,
    available,
    requiresVariant:
      typeof p.requiresVariant === 'boolean'
        ? p.requiresVariant
        : Boolean(p.has_variants) || variants.length > 0,
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
    if (!handle) {
      return jsonCatalogBridgeResponse(400, { status: 'error', code: 'INVALID_REQUEST', message: 'Collection handle is required' }, method);
    }
    const isAll = handle === 'all';
    const ep = isAll
      ? 'https://catalog.baci.internal/v1/search?limit=24'
      : \`https://catalog.baci.internal/v1/search?category=\${encodeURIComponent(handle)}\`;
    const up = await fetchCatalogJson(ep, isAll ? 'search' : 'collection');
    if (!up.ok) {
      return jsonCatalogBridgeResponse(502, { status: 'error', code: 'SNAPSHOT_STALE', message: 'Catalog temporarily unavailable' }, method);
    }
    if (!isAll && !up.data.categoryExists) {
      return jsonCatalogBridgeResponse(404, { status: 'error', code: 'NOT_FOUND', message: 'Collection not found' }, method);
    }
    const mapped = [];
    const assets = {};
    for (const row of up.data.products || []) {
      const item = toSdkPublicProduct(row, assets);
      if (!item) {
        return jsonCatalogBridgeResponse(502, { status: 'error', code: 'SNAPSHOT_STALE', message: 'Malformed catalog product record' }, method);
      }
      mapped.push(item);
    }
    const gen = up.data.generation;
    const availGen = up.data.availabilityGeneration;
    const revision =
      gen != null && availGen != null
        ? \`\${gen}:\${availGen}\`
        : String(gen ?? availGen ?? '0');
    return jsonCatalogBridgeResponse(200, { status: 'ok', value: { products: mapped, revision }, assets }, method);
  }
  if (op === 'product') {
    const raw = (url.searchParams.get('handle') || '').trim().replace(/^\\/+|\\/+$/g, '');
    if (!raw) {
      return jsonCatalogBridgeResponse(400, { status: 'error', code: 'INVALID_REQUEST', message: 'Product handle is required' }, method);
    }
    const segs = raw.split('/').filter(Boolean);
    const slug = segs[segs.length - 1] || '';
    const cat = segs.length === 2 ? segs[0] : '';
    const catQ = cat ? \`category=\${encodeURIComponent(cat)}&\` : '';
    const up = await fetchCatalogJson(\`https://catalog.baci.internal/v1/product?\${catQ}productSlug=\${encodeURIComponent(slug)}\`, 'product');
    if (!up.ok) {
      return jsonCatalogBridgeResponse(502, { status: 'error', code: 'SNAPSHOT_STALE', message: 'Product temporarily unavailable' }, method);
    }
    if (!up.data.product) {
      return jsonCatalogBridgeResponse(404, { status: 'error', code: 'NOT_FOUND', message: 'Product not found' }, method);
    }
    const assets = {};
    const mapped = toSdkPublicProduct(up.data.product, assets);
    if (!mapped) {
      return jsonCatalogBridgeResponse(502, { status: 'error', code: 'SNAPSHOT_STALE', message: 'Malformed product record' }, method);
    }
    return jsonCatalogBridgeResponse(200, { status: 'ok', value: mapped, assets }, method);
  }
  if (op === 'variants') {
    const productId = (url.searchParams.get('productId') || '').trim();
    if (!productId) {
      return jsonCatalogBridgeResponse(400, { status: 'error', code: 'INVALID_REQUEST', message: 'Product ID is required' }, method);
    }
    const up = await fetchCatalogJson(\`https://catalog.baci.internal/v1/product?productId=\${encodeURIComponent(productId)}&productSlug=\${encodeURIComponent(productId)}\`, 'product');
    if (!up.ok) {
      return jsonCatalogBridgeResponse(502, { status: 'error', code: 'SNAPSHOT_STALE', message: 'Variants temporarily unavailable' }, method);
    }
    if (!up.data.product) {
      return jsonCatalogBridgeResponse(404, { status: 'error', code: 'NOT_FOUND', message: 'Product not found' }, method);
    }
    const mapped = toSdkPublicProduct(up.data.product, null);
    if (!mapped) {
      return jsonCatalogBridgeResponse(502, { status: 'error', code: 'SNAPSHOT_STALE', message: 'Malformed variant record' }, method);
    }
    return jsonCatalogBridgeResponse(200, { status: 'ok', value: mapped.variants }, method);
  }
  return jsonCatalogBridgeResponse(400, { status: 'error', code: 'INVALID_REQUEST', message: 'Unsupported catalog operation' }, method);
}
`;
}
