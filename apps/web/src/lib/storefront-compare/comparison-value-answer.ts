interface ComparedOffer {
  name: string;
  price?: number | null;
  condition?: string | null;
}

export function buildComparisonValueAnswer(
  left: ComparedOffer,
  right: ComparedOffer,
  currency: string,
  locale: string
): string {
  if (
    !left.price ||
    !right.price ||
    left.price < 0 ||
    right.price < 0 ||
    !Number.isFinite(left.price) ||
    !Number.isFinite(right.price)
  ) {
    return 'Value is undetermined because a current starting price is not documented for both listings. Confirm the selected configuration and condition on each product page.';
  }
  const format = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  });
  const conditionsDiffer =
    left.condition &&
    right.condition &&
    left.condition.toLowerCase() !== right.condition.toLowerCase();
  const context = conditionsDiffer
    ? ' These listings have different conditions, so this is not an equivalent-condition saving.'
    : ' Starting prices may cover different configurations; confirm storage, condition and included accessories before comparing value.';
  if (left.price === right.price) {
    return `Both listings have the same starting price (${format.format(left.price)}). There is no starting-price saving on either listing.${context}`;
  }
  const lower = left.price < right.price ? left : right;
  return `${lower.name} has the lower starting price by ${format.format(Math.abs(left.price - right.price))}.${context} A lower price alone does not establish better specifications or overall value.`;
}
