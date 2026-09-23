export function blocksShippingQuoteReplacement(input: {
  previousQuoteId: string | null;
  nextQuoteId: string | null;
  chargeStatuses: string[];
}): boolean {
  if (input.previousQuoteId === input.nextQuoteId) return false;
  return input.chargeStatuses.some((status) => status !== 'refunded');
}
