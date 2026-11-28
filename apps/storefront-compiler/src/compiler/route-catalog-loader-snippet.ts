export function buildRouteCatalogLoaderSnippet(): string {
  return `
function isFilterOnlyRouteParam(key) {
  return key === 'brand' || key === 'condition' || key === 'filter' || key === 'page';
}

async function loadDeclaredRouteCatalog(matchedRoute, searchParams) {
  let status = 200;
  let view = matchedRoute ? matchedRoute.view : 'not_found';
  let title = 'Storefront';
  let products = [];
  let facets = EMPTY_FACETS;
  let productDetail = null;
  let publicDataRevision = '0';

  if (!matchedRoute) {
    status = 404;
    view = 'not_found';
    title = 'Page Not Found';
  } else if (matchedRoute.view === 'home') {
    const upstream = await fetchCatalogJson('https://catalog.baci.internal/v1/search?limit=12', 'search');
    if (!upstream.ok) {
      status = 502;
      title = 'Catalog Temporarily Unavailable';
    } else {
      title = upstream.data.title || 'Featured Devices';
      products = (upstream.data.products || []).map(normalizeSsrCatalogProduct);
      facets = normalizeSsrCatalogFacets(upstream.data.facets);
      publicDataRevision = formatUpstreamRevision(upstream.data);
    }
  } else if (matchedRoute.view === 'search') {
    const canonical = canonicalizeSearchParams(searchParams);
    const searchCat =
      matchedRoute.params.category ||
      matchedRoute.params.categoryId ||
      matchedRoute.params.categorySlug ||
      matchedRoute.params.collection ||
      matchedRoute.params.collectionId ||
      matchedRoute.params.collectionSlug ||
      '';
    const searchTerm =
      matchedRoute.params.q ||
      matchedRoute.params.query ||
      matchedRoute.params.term ||
      matchedRoute.params.search ||
      matchedRoute.params.keyword ||
      matchedRoute.params.filter ||
      (Object.entries(matchedRoute.params).find(
        ([k]) =>
          !isFilterOnlyRouteParam(k) &&
          k !== 'category' &&
          k !== 'categoryId' &&
          k !== 'categorySlug' &&
          k !== 'collection' &&
          k !== 'collectionId' &&
          k !== 'collectionSlug'
      )?.[1] ||
        '');
    if (searchCat) canonical.set('category', searchCat);
    if (matchedRoute.params.brand) canonical.set('brand', matchedRoute.params.brand);
    if (matchedRoute.params.condition) canonical.set('condition', matchedRoute.params.condition);
    if (matchedRoute.params.page) canonical.set('page', matchedRoute.params.page);
    if (searchTerm) canonical.set('q', searchTerm);
    const qs = canonical.toString();
    const endpoint = qs
      ? \`https://catalog.baci.internal/v1/search?\${qs}\`
      : 'https://catalog.baci.internal/v1/search';
    const upstream = await fetchCatalogJson(endpoint, 'search');
    if (!upstream.ok) {
      status = 502;
      title = 'Search Temporarily Unavailable';
    } else {
      title = upstream.data.title || 'Search Catalog';
      products = (upstream.data.products || []).map(normalizeSsrCatalogProduct);
      facets = normalizeSsrCatalogFacets(upstream.data.facets);
      publicDataRevision = formatUpstreamRevision(upstream.data);
    }
  } else if (matchedRoute.view === 'cart') {
    title = 'Your Cart';
  } else if (matchedRoute.view === 'editorial') {
    const paramValues = Object.values(matchedRoute.params);
    title = matchedRoute.params.pageSlug || matchedRoute.params.pageId || matchedRoute.params.page || paramValues[paramValues.length - 1] || 'Editorial';
  } else if (matchedRoute.view === 'collection') {
    const colEntries = Object.entries(matchedRoute.params);
    const lastCol = colEntries[colEntries.length - 1];
    const prevCol = colEntries[colEntries.length - 2];
    const trailingFilter = Boolean(lastCol && isFilterOnlyRouteParam(lastCol[0]));
    const categoryParam =
      matchedRoute.params.category ||
      matchedRoute.params.categoryId ||
      matchedRoute.params.categorySlug ||
      matchedRoute.params.collection ||
      matchedRoute.params.collectionId ||
      matchedRoute.params.collectionSlug ||
      (trailingFilter
        ? matchedRoute.params.handle ||
          matchedRoute.params.slug ||
          (prevCol && !isFilterOnlyRouteParam(prevCol[0]) ? prevCol[1] : '')
        : lastCol && !isFilterOnlyRouteParam(lastCol[0])
          ? lastCol[1]
          : '');
    const colQuery = canonicalizeSearchParams(searchParams);
    if (categoryParam) colQuery.set('category', categoryParam);
    if (matchedRoute.params.brand) colQuery.set('brand', matchedRoute.params.brand);
    if (matchedRoute.params.condition) colQuery.set('condition', matchedRoute.params.condition);
    if (matchedRoute.params.page) colQuery.set('page', matchedRoute.params.page);
    if (matchedRoute.params.filter && !colQuery.get('q')) colQuery.set('q', matchedRoute.params.filter);
    const qs = colQuery.toString();
    const endpoint = qs
      ? \`https://catalog.baci.internal/v1/search?\${qs}\`
      : 'https://catalog.baci.internal/v1/search';
    const upstream = await fetchCatalogJson(endpoint, categoryParam ? 'collection' : 'search');
    if (!upstream.ok) {
      status = 502;
      title = 'Category Temporarily Unavailable';
    } else if (categoryParam && !upstream.data.categoryExists) {
      status = 404;
      view = 'not_found';
      title = 'Category Not Found';
    } else {
      title =
        upstream.data.title ||
        categoryParam ||
        matchedRoute.params.brand ||
        matchedRoute.params.condition ||
        matchedRoute.params.filter ||
        'Collection';
      products = (upstream.data.products || []).map(normalizeSsrCatalogProduct);
      facets = normalizeSsrCatalogFacets(upstream.data.facets);
      publicDataRevision = formatUpstreamRevision(upstream.data);
    }
  } else if (matchedRoute.view === 'product') {
    const paramEntries = Object.entries(matchedRoute.params);
    const lastEntry = paramEntries[paramEntries.length - 1];
    const prevEntry = paramEntries[paramEntries.length - 2];
    const isNonProductParam = (k) =>
      k === 'variant' || k === 'variantId' || k === 'category' || k === 'categoryId' || k === 'categorySlug' || k === 'collection' || k === 'collectionId' || k === 'collectionSlug' || isFilterOnlyRouteParam(k);
    const trailingIsVariant = lastEntry && (lastEntry[0] === 'variant' || lastEntry[0] === 'variantId');
    const explicitId = matchedRoute.params.productId || '';
    const explicitSku = matchedRoute.params.sku || '';
    const productSlug =
      matchedRoute.params.productSlug ||
      matchedRoute.params.product ||
      matchedRoute.params.itemSlug ||
      (!explicitId && !explicitSku
        ? (trailingIsVariant
            ? matchedRoute.params.slug || matchedRoute.params.handle || (prevEntry && !isNonProductParam(prevEntry[0]) ? prevEntry[1] : '')
            : lastEntry && !isNonProductParam(lastEntry[0]) ? lastEntry[1] : '')
        : '');
    if (!explicitSku && !productSlug && !explicitId) {
      status = 404;
      view = 'not_found';
      title = 'Product Not Found';
    } else {
      const categoryVal =
        matchedRoute.params.category || matchedRoute.params.categoryId || matchedRoute.params.categorySlug || matchedRoute.params.collection || matchedRoute.params.collectionId || matchedRoute.params.collectionSlug || '';
      const qParts = [];
      if (categoryVal) qParts.push(\`category=\${encodeURIComponent(categoryVal)}\`);
      if (explicitSku) qParts.push(\`sku=\${encodeURIComponent(explicitSku)}\`);
      if (productSlug) qParts.push(\`productSlug=\${encodeURIComponent(productSlug)}\`);
      else if (explicitId) qParts.push(\`productId=\${encodeURIComponent(explicitId)}\`);
      const upstream = await fetchCatalogJson(\`https://catalog.baci.internal/v1/product?\${qParts.join('&')}\`, 'product');
      if (!upstream.ok) {
        status = 502;
        title = 'Product Temporarily Unavailable';
      } else if (!upstream.data.product) {
        status = 404;
        view = 'not_found';
        title = 'Product Not Found';
      } else {
        const candidate = normalizeSsrCatalogProduct(upstream.data.product);
        const reqBrand = matchedRoute.params.brand || '';
        const reqCond = matchedRoute.params.condition || '';
        const brandMismatch = Boolean(reqBrand) && (!candidate.brand || candidate.brand.toLowerCase() !== reqBrand.toLowerCase());
        const condMismatch = Boolean(reqCond) && (!candidate.condition || candidate.condition.toLowerCase() !== reqCond.toLowerCase());
        if (brandMismatch || condMismatch) {
          status = 404;
          view = 'not_found';
          title = 'Product Not Found';
        } else {
          productDetail = candidate;
          title = productDetail.name;
          publicDataRevision = formatUpstreamRevision(upstream.data);
        }
      }
    }
  }

  return { status, view, title, products, facets, productDetail, publicDataRevision };
}
`;
}
