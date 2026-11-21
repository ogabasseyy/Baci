import { looksLikeNairaPricedList } from './kuda-naira-list-verdict';
import { logger } from './logger';

/**
 * Refuse a Kuda answer that looks priced in naira instead of kobo. Every
 * caller already treats a failed Kuda fetch as "no confirmed prices" (last
 * good list from the past day, else the purchase fails closed), so a list
 * 100x too cheap is never shown or sold. An answer with only a few fixed
 * prices is refused as well, since its unit cannot be established.
 */
export function assertKudaBillListInKobo(
  rawFixedPricesKobo: number[],
  billTypeName: string
): void {
  const verdict = looksLikeNairaPricedList(rawFixedPricesKobo);
  if (!(verdict.isNaira || verdict.tooFewToJudge)) return;
  logger.error({
    message: verdict.isNaira
      ? 'Kuda bill list looks priced in naira, not kobo; refusing it'
      : 'Kuda bill list has too few fixed prices to confirm its unit; refusing it',
    billTypeName,
    belowFloor: verdict.belowFloor,
    fixedPrices: verdict.fixedPrices,
  });
  throw new Error('Bill prices could not be confirmed as kobo');
}
