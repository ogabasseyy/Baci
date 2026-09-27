export function getProductImageUrl(product: {
  image?: string;
  image_url?: string;
}): string | undefined {
  return product.image || product.image_url;
}
