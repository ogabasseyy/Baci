import { stripProviderNames } from '@baci/shared/lib';
import type { Biller } from './kuda';

function normalizeBillerName(name: string) {
  return stripProviderNames(name).trim().replace(/\s+/g, ' ').toLowerCase();
}

/** The purchase names this biller, as the billers list showed it. */
function namesMatch(listed: string, sent: string) {
  return listed !== '' && (sent === listed || sent.startsWith(`${listed} - `));
}

function plainBillerName(name: string) {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The listings under the biller the purchase names: an exact (case and
 * space free) name match first, so two billers that only differ by a
 * provider tag stay apart; the provider-stripped name (as the billers list
 * shows it) only when nothing matches exactly.
 */
export function chosenListings<T extends { biller: Biller }>(
  listing: T[],
  billerName: string
): T[] {
  // Most specific first: a literal name match, then the checkout's decorated
  // "<biller> - <package group>" form, each before the provider-stripped
  // name. Among decorated matches only the longest listed name counts, so
  // "DSTV - PREMIUM - Monthly" uses "DSTV - PREMIUM", never also "DSTV".
  const sentPlain = plainBillerName(billerName);
  const sentNormalized = normalizeBillerName(billerName);
  const plainOf = (listed: Biller) => plainBillerName(listed.billerName);
  const normOf = (listed: Biller) => normalizeBillerName(listed.billerName);
  // Each tier scores a listed biller: 0 = no match, higher = more specific.
  const tiers: Array<(listed: Biller) => number> = [
    (listed) => (plainOf(listed) === sentPlain ? 1 : 0),
    (listed) =>
      namesMatch(plainOf(listed), sentPlain) ? plainOf(listed).length : 0,
    (listed) =>
      normOf(listed) !== '' && normOf(listed) === sentNormalized ? 1 : 0,
    (listed) =>
      namesMatch(normOf(listed), sentNormalized) ? normOf(listed).length : 0,
  ];
  for (const score of tiers) {
    const scored = listing.map((entry) => ({ entry, s: score(entry.biller) }));
    const best = Math.max(0, ...scored.map(({ s }) => s));
    if (best > 0) {
      return scored.filter(({ s }) => s === best).map(({ entry }) => entry);
    }
  }
  return [];
}
