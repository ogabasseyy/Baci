export function buildProductCanonicalPathSnippet(): string {
  return `
function tryBuildSingleProductRoute(p, routePath, slug) {
  const segs = routePath.split('/').filter(Boolean);
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
