export function buildSsrCatalogProjectionSnippet(): string {
  return `
function normalizeSsrCatalogProduct(p) {
  const rawVars = Array.isArray(p.variants) ? p.variants : [];
  const variants = rawVars.map((v) => {
    const vPrice = isFiniteNumber(v.priceNgn) ? v.priceNgn : v.price;
    const vAvail = typeof v.available === 'boolean' ? v.available : v.inStock === true;
    return {
      id: v.id,
      label: v.label,
      ...(typeof v.storage === 'string' ? { storage: v.storage } : {}),
      ...(typeof v.color === 'string' ? { color: v.color } : {}),
      priceNgn: vPrice,
      price: isFiniteNumber(v.price) ? v.price : vPrice,
      inStock: vAvail,
      available: vAvail,
    };
  });
  const pPrice = isFiniteNumber(p.priceNgn) ? p.priceNgn : p.price;
  const pAvail =
    typeof p.available === 'boolean'
      ? p.available
      : typeof p.inStock === 'boolean'
        ? p.inStock
        : variants.some((v) => v.available);
  const safeImg =
    p.image && typeof p.image === 'object' && !Array.isArray(p.image) && typeof p.image.assetId === 'string' && p.image.assetId.length > 0
      ? { assetId: p.image.assetId, alt: typeof p.image.alt === 'string' && p.image.alt.length > 0 ? p.image.alt : p.name }
      : undefined;
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    categorySlug: typeof p.categorySlug === 'string' ? p.categorySlug : '',
    ...(typeof p.categoryName === 'string' ? { categoryName: p.categoryName } : {}),
    brand: typeof p.brand === 'string' ? p.brand : '',
    condition: typeof p.condition === 'string' ? p.condition : '',
    priceNgn: pPrice,
    price: isFiniteNumber(p.price) ? p.price : pPrice,
    currency: typeof p.currency === 'string' ? p.currency : 'NGN',
    inStock: pAvail,
    available: pAvail,
    ...(typeof p.requiresVariant === 'boolean' ? { requiresVariant: p.requiresVariant } : {}),
    ...(typeof p.has_variants === 'boolean' ? { has_variants: p.has_variants } : {}),
    imageUrl: typeof p.imageUrl === 'string' ? p.imageUrl : '',
    imageAlt: typeof p.imageAlt === 'string' && p.imageAlt.length > 0 ? p.imageAlt : p.name,
    ...(safeImg ? { image: safeImg } : {}),
    shortSpecs: typeof p.shortSpecs === 'string' ? p.shortSpecs : '',
    ...(typeof p.canonicalPath === 'string' ? { canonicalPath: p.canonicalPath } : {}),
    variants,
  };
}

function normalizeSsrCatalogFacets(f) {
  if (!f || typeof f !== 'object' || Array.isArray(f)) return EMPTY_FACETS;
  return {
    brands: Array.isArray(f.brands) ? f.brands.map((b) => ({ value: b.value, count: b.count })) : [],
    conditions: Array.isArray(f.conditions) ? f.conditions.map((c) => ({ value: c.value, count: c.count })) : [],
    totalMatches: isFiniteNumber(f.totalMatches) ? f.totalMatches : 0,
  };
}
`;
}
