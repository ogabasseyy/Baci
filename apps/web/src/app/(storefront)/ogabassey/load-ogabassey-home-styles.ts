export function loadOgabasseyHomeStyles() {
  return Promise.all([
    import('@/app/(storefront)/storefront-core.css'),
    import('@/app/(storefront)/storefront-home.css'),
  ]);
}
