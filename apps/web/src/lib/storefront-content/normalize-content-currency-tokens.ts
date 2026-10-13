const CURRENCY_TOKEN_BY_SYMBOL: Record<string, string> = {
  $: 'usd',
  '£': 'gbp',
  '€': 'eur',
  '₦': 'ngn',
};

export function normalizeContentCurrencyTokens(value: string) {
  return value
    .replace(/\bus\s*\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)/giu, ' usd $1')
    .replace(
      /([£$€₦])\s*(\d+(?:,\d{3})*(?:\.\d+)?)/gu,
      (_, symbol: string, amount: string) =>
        ` ${CURRENCY_TOKEN_BY_SYMBOL[symbol] ?? ''} ${amount} `
    )
    .replace(/\bus(\d+(?:,\d{3})*(?:\.\d+)?)\b/giu, ' usd $1')
    .replace(
      /\b(usd|gbp|eur|ngn)\s*(\d+(?:,\d{3})*(?:\.\d+)?)/giu,
      (_, currency: string, amount: string) => {
        const normalizedAmount = amount
          .replace(/,/gu, '')
          .replace(/\.0+$/u, '');
        return `${currency} ${normalizedAmount}`;
      }
    )
    .replace(/\s+/gu, ' ')
    .replace(/\s+([,.;!?])/gu, '$1')
    .trim();
}
