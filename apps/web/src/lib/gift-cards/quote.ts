const QUOTE_URL =
  'https://api.spendjuice.com/exchange/quote?source_currency=NGN&target_currency=USD&lock=false';

export async function getGiftCardQuote(
  supplierUsdCents: number,
  markupBps: number,
  rateKey: string,
  request = fetch
) {
  const unavailable = 'Gift card pricing is temporarily unavailable';
  try {
    const response = await request(QUOTE_URL, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
      headers: { Authorization: rateKey, Accept: 'application/json' },
    });
    if (response.ok) {
      const { data } = await response.json();
      if (
        data?.symbol === 'USD-NGN' &&
        data.type === 'sell' &&
        data.locked === false &&
        Number.isSafeInteger(data.rate) &&
        data.rate > 0
      ) {
        const numerator =
          BigInt(supplierUsdCents) *
          BigInt(data.rate) *
          BigInt(10_000 + markupBps);
        const totalKobo = Number((numerator + 999_999n) / 1_000_000n);
        if (Number.isSafeInteger(totalKobo) && totalKobo > 0) {
          return totalKobo;
        }
      }
    }
  } catch {
    // The customer does not need the supplier response or credential details.
  }
  throw new Error(unavailable);
}
