import { looksLikeNairaPricedList } from './kuda-naira-list-verdict';
import { logger } from './logger';

/**
 * Refuse a Kuda answer that looks priced in naira instead of kobo. Every
 * caller already treats a failed Kuda fetch as "no confirmed prices" (last
 * good list from the past day, else the purchase fails closed), so a list
 * 100x too cheap is never shown or sold.
 */
export function assertKudaBillListInKobo(
  rawFixedPricesKobo: number[],
  billTypeName: string
): void {
  const verdict = looksLikeNairaPricedList(rawFixedPricesKobo);
  if (!verdict.isNaira) return;
  logger.error({
    message: 'Kuda bill list looks priced in naira, not kobo; refusing it',
    billTypeName,
    belowFloor: verdict.belowFloor,
    fixedPrices: verdict.fixedPrices,
  });
  throw new Error('Bill prices could not be confirmed as kobo');
}
