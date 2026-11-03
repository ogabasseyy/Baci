/** Start dependent offer work as soon as product owners are available. */
export async function fetchCartCatalogConcurrently<
  ProductResult,
  VariantResult,
  OfferResult,
>(
  products: PromiseLike<ProductResult>,
  variants: PromiseLike<VariantResult>,
  loadOffers: (products: ProductResult) => Promise<OfferResult>
) {
  const [productAndOffers, variantsResult] = await Promise.all([
    Promise.resolve(products).then(async (productsResult) => ({
      productsResult,
      offerMap: await loadOffers(productsResult),
    })),
    variants,
  ]);
  return { ...productAndOffers, variantsResult };
}
