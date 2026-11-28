export function buildProductCanonicalPathSnippet(): string {
  return `
function tryBuildSingleProductRoute(p, routePath, slug) {
  const segs = routePath.split('/').filter(Boolean);
  const dynIdx = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s.startsWith(':') || (s.startsWith('[') && s.endsWith(']'))) dynIdx.push(i);
  }
  const NON_PROD_PARAMS = new Set(['variant', 'variantId', 'category', 'categoryId', 'categorySlug', 'collection', 'collectionId', 'collectionSlug', 'brand', 'condition', 'filter', 'page']);
  const EXPLICIT_PROD_PARAMS = new Set(['productSlug', 'product', 'itemSlug', 'productId', 'sku', 'slug', 'handle']);
  let explicitDyn;
  for (let d = dynIdx.length - 1; d >= 0; d--) {
    const seg = segs[dynIdx[d]];
    const nm = seg.startsWith(':') ? seg.slice(1) : seg.slice(1, -1);
    if (EXPLICIT_PROD_PARAMS.has(nm)) {
      explicitDyn = dynIdx[d];
      break;
    }
  }
  let fallbackDyn;
  for (let d = dynIdx.length - 1; d >= 0; d--) {
    const seg = segs[dynIdx[d]];
    const nm = seg.startsWith(':') ? seg.slice(1) : seg.slice(1, -1);
    if (!NON_PROD_PARAMS.has(nm)) {
      fallbackDyn = dynIdx[d];
      break;
    }
  }
  const slugIdx = explicitDyn !== undefined ? explicitDyn : fallbackDyn;
  if (slugIdx === undefined) return undefined;
  const slugSeg = segs[slugIdx];
  const slugParam = slugSeg.startsWith(':') ? slugSeg.slice(1) : slugSeg.slice(1, -1);
  if (NON_PROD_PARAMS.has(slugParam)) return undefined;
  const out = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (!s.startsWith(':') && !(s.startsWith('[') && s.endsWith(']'))) {
      out.push(s);
      continue;
    }
    const name = s.startsWith(':') ? s.slice(1) : s.slice(1, -1);
    if (name === 'categoryId' || name === 'collectionId') {
      if (typeof p.categoryId !== 'string' || p.categoryId.length === 0) return undefined;
      out.push(encodeURIComponent(p.categoryId));
    } else if (name === 'category' || name === 'categorySlug' || name === 'collection' || name === 'collectionSlug') {
      if (typeof p.categorySlug !== 'string' || p.categorySlug.length === 0) return undefined;
      out.push(encodeURIComponent(p.categorySlug));
    } else if (name === 'brand') {
      if (typeof p.brand !== 'string' || p.brand.length === 0) return undefined;
      out.push(encodeURIComponent(p.brand));
    } else if (name === 'condition') {
      if (typeof p.condition !== 'string' || p.condition.length === 0) return undefined;
      out.push(encodeURIComponent(p.condition));
    } else if (name === 'filter' || name === 'page') {
      return undefined;
    } else if (name === 'productId') {
      if (typeof p.id !== 'string' || p.id.length === 0) return undefined;
      out.push(encodeURIComponent(p.id));
    } else if (name === 'sku') {
      const topSku = typeof p.sku === 'string' && p.sku.length > 0 ? p.sku : '';
      const varSkus = Array.isArray(p.variants)
        ? Array.from(new Set(p.variants.map((v) => (v && typeof v.sku === 'string' && v.sku.length > 0 ? v.sku : '')).filter(Boolean)))
        : [];
      const resolvedSku = topSku || (varSkus.length === 1 ? varSkus[0] : '');
      if (!resolvedSku) return undefined;
      out.push(encodeURIComponent(resolvedSku));
    } else if (name === 'variant' || name === 'variantId') {
      const v0 = Array.isArray(p.variants) && p.variants[0] && p.variants[0].id ? String(p.variants[0].id) : '';
      if (!v0) return undefined;
      out.push(encodeURIComponent(v0));
    } else if (name === 'productSlug' || name === 'product' || name === 'itemSlug' || name === 'slug' || name === 'handle' || i === slugIdx) {
      out.push(encodeURIComponent(slug));
    } else {
      return undefined;
    }
  }
  return '/' + out.join('/');
}

function resolveProductCanonicalPath(p) {
  if (typeof p.canonicalPath === 'string' && p.canonicalPath.startsWith('/') && !p.canonicalPath.startsWith('//')) {
    return p.canonicalPath;
  }
  const slug = typeof p.slug === 'string' && p.slug.length > 0 ? p.slug : '';
  if (!slug || !Array.isArray(DECLARED_ROUTES)) return undefined;
  for (let rIdx = 0; rIdx < DECLARED_ROUTES.length; rIdx++) {
    const r = DECLARED_ROUTES[rIdx];
    if (!r || r.view !== 'product' || typeof r.path !== 'string') continue;
    const built = tryBuildSingleProductRoute(p, r.path, slug);
    if (built !== undefined) return built;
  }
  return undefined;
}
`;
}
