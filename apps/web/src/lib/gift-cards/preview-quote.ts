import 'server-only';

import { cacheLife } from 'next/cache';
import { getGiftCardQuote } from './quote';

// The preview is informational. Wallet issuance and confirmation use the
// uncached quote helper directly.
export async function getGiftCardPreviewQuote(
  supplierUsdCents: number,
  markupBps: number
) {
  'use cache';
  cacheLife({ stale: 30, revalidate: 30, expire: 60 });
  const rateKey = process.env.JUICYWAY_EXCHANGE_RATE_READ_KEY?.trim();
  if (!rateKey) throw new Error('Gift card pricing is temporarily unavailable');
  try {
    return await getGiftCardQuote(supplierUsdCents, markupBps, rateKey);
  } catch {
    // The customer sees an unavailable price. Logs contain no supplier body.
    console.warn('[gift-card-preview] Juicyway quote unavailable');
    throw new Error('Gift card pricing is temporarily unavailable');
  }
}
