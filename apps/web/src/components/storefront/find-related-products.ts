import type { Product } from '@/lib/products';

function compareCodepoints(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function findRelatedProducts(
  currentProduct: Product,
  allProducts: Product[],
  maxResults: number
): Product[] {
  const candidates = allProducts.filter(
    (product) => product.id !== currentProduct.id && product.status === 'active'
  );
  if (candidates.length === 0) return [];

  const scored = candidates.map((product) => {
    let score = 0;
    if (
      product.category &&
      currentProduct.category &&
      product.category === currentProduct.category
    ) {
      score += 10;
    }
    if (
      product.brand &&
      currentProduct.brand &&
      product.brand === currentProduct.brand
    ) {
      score += 5;
    }
    const priceDiff =
      currentProduct.price === 0
        ? product.price === 0
          ? 0
          : Number.POSITIVE_INFINITY
        : Math.abs(product.price - currentProduct.price) / currentProduct.price;
    if (priceDiff <= 0.3) score += 3;
    else if (priceDiff <= 0.5) score += 1;
    return { product, score };
  });

  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return (
      compareCodepoints(left.product.name, right.product.name) ||
      compareCodepoints(left.product.id, right.product.id)
    );
  });
  const withScore = scored.filter(({ score }) => score > 0);
  if (withScore.length > 0) {
    return withScore.slice(0, maxResults).map(({ product }) => product);
  }

  return candidates
    .toSorted(
      (left, right) =>
        compareCodepoints(left.name, right.name) ||
        compareCodepoints(left.id, right.id)
    )
    .slice(0, maxResults);
}
