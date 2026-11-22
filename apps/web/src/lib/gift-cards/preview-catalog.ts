const cards = [
  { id: '3007', brand: 'Amazon', denomination: 5 },
  { id: '3006', brand: 'Amazon', denomination: 10 },
  { id: '2376', brand: 'Google Play', denomination: 5 },
  { id: '2379', brand: 'Google Play', denomination: 10 },
  { id: '2067', brand: 'Xbox Live', denomination: 5 },
  { id: '2068', brand: 'Xbox Live', denomination: 10 },
  { id: '2844', brand: 'PlayStation Store', denomination: 10 },
] as const;

const giftCardSearch = /\bgift\s*-?\s*cards?\b/i;
const brandSearch = /\b(?:amazon|google\s+play|xbox|playstation|psn)\b/i;

export function findGiftCardPreviewMatches(query: string) {
  const brand = query
    .match(brandSearch)?.[0]
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!brand && !giftCardSearch.test(query)) return [];
  return getGiftCardPreviewCatalog().flatMap((card) =>
    !brand ||
    card.brand.toLowerCase().startsWith(brand === 'psn' ? 'playstation' : brand)
      ? [{ id: card.id, brand: card.brand, denomination: card.denomination }]
      : []
  );
}

export function isGiftCardPreviewEnabled(slug: string) {
  return (
    slug === 'ogabassey' && process.env.OGABASSEY_GIFT_CARD_PREVIEW === 'true'
  );
}

export function getGiftCardPreviewCatalog() {
  try {
    const costs: unknown = JSON.parse(
      process.env.OGABASSEY_GIFT_CARD_PREVIEW_USD_CENTS || '{}'
    );
    if (costs === null || typeof costs !== 'object') return [];
    return cards.flatMap((card) => {
      const usdCents = (costs as Record<string, unknown>)[card.id];
      if (
        typeof usdCents !== 'number' ||
        !Number.isSafeInteger(usdCents) ||
        usdCents <= 0
      ) {
        return [];
      }
      return [{ ...card, usdCents }];
    });
  } catch {
    return [];
  }
}
