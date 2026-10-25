interface PairProduct {
  name: string;
  slug: string;
  product_key_specs?: Record<string, unknown> | null;
}
function productType(product: PairProduct): string | null {
  const text = `${product.name} ${product.slug}`
    .toLowerCase()
    .replace(/-/g, ' ');
  if (/\b(charger|charging dock|charging station)\b/.test(text))
    return 'charger';
  if (/\b(airtag|tracker)\b/.test(text)) return 'tracker';
  if (/\b(pencil|stylus)\b/.test(text)) return 'stylus';
  if (/\b(airpods|earbuds|earphones)\b/.test(text))
    return /\bmax\b/.test(text) ? 'headphones' : 'earbuds';
  if (/\b(headphones|headset)\b/.test(text) && !/\bvr\b/.test(text))
    return 'headphones';
  if (/\b(jbl go|speaker|soundbar)\b/.test(text)) return 'speaker';
  if (/\b(vr|quest)\b/.test(text)) return 'vr headset';
  return null;
}
function identifier(product: PairProduct, keys: string[]): string[] {
  const specs = product.product_key_specs ?? {};
  return keys.flatMap((key) => {
    const value = specs[key];
    return (Array.isArray(value) ? value : [value])
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.toLowerCase().replace(/[^a-z0-9]/g, ''))
      .filter(Boolean);
  });
}
export function isCompatibleProductPair(
  left: PairProduct,
  right: PairProduct
): boolean {
  const leftType = productType(left);
  const rightType = productType(right);
  if (leftType !== rightType && (leftType || rightType)) return false;
  // Family TV names cannot establish a model/year/size comparison.
  if (
    [left, right].some((product) =>
      /^(?:lg )?(?:oled|uhd 4k hdr) smart tv$/i.test(product.name.trim())
    )
  )
    return false;
  const leftParts = identifier(left, [
    'part_number',
    'part_numbers',
    'manufacturer_part_number',
    'mpn',
  ]);
  const rightParts = identifier(right, [
    'part_number',
    'part_numbers',
    'manufacturer_part_number',
    'mpn',
  ]);
  if (leftParts.some((part) => rightParts.includes(part))) return false;
  // Exact hardware model aliases are excluded until an offer distinction is documented.
  const modelTokens = (product: PairProduct): string[] =>
    `${product.name} ${product.slug}`
      .toLowerCase()
      .match(/\b\d{2}-[a-z]{2}\d{4}[a-z]+\b/g) ?? [];
  if (modelTokens(left).some((model) => modelTokens(right).includes(model)))
    return false;
  return left.slug !== right.slug;
}
