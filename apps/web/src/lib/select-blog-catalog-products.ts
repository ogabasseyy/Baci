/** Keep the eight display cards plus explicitly referenced linked products, bounded to 32. */
export function selectBlogCatalogProducts<T extends { id: string }>(
  products: T[],
  content: unknown
): T[] {
  const source =
    typeof content === 'string' ? content : JSON.stringify(content ?? '');
  const references = new Set(
    Array.from(
      source.matchAll(
        /\{\{catalog-price:([a-f0-9-]{36})(?::variant:[a-f0-9-]{36})?\}\}/gi
      ),
      (match) => match[1].toLowerCase()
    )
  );
  return products
    .filter(
      (product, index) => index < 8 || references.has(product.id.toLowerCase())
    )
    .slice(0, 32);
}
