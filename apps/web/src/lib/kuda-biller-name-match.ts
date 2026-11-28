import { stripProviderNames } from '@baci/shared/lib';
import type { Biller } from './kuda';

function normalizeBillerName(name: string) {
  return stripProviderNames(name).trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The decorated checkout form "<biller> - <package path>": the part after
 * the listed biller's name, or null when the sent name isn't decorated
 * with it.
 */
function decoratedRemainder(listed: string, sent: string): string | null {
  return listed !== '' && sent.startsWith(`${listed} - `)
    ? sent.slice(listed.length + 3)
    : null;
}

function plainBillerName(name: string) {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The listings under the biller the purchase names: an exact (case and
 * space free) name match first, so two billers that only differ by a
 * provider tag stay apart; the provider-stripped name (as the billers list
 * shows it) only when nothing matches exactly.
 *
 * Web and mobile checkouts send "<biller> - <package path>" (the selected
 * items' names joined by " / "). A listed biller matched by that prefix
 * counts only when `acceptsPath` confirms the rest is the requested
 * package's path under it, so a missing "DSTV - PREMIUM" can never fall
 * back to "DSTV" (and its price) for "DSTV - PREMIUM - Monthly".
 */
export function chosenListings<T extends { biller: Biller }>(
  listing: T[],
  billerName: string,
  acceptsPath: (listed: Biller, path: string) => boolean = () => true
): T[] {
  const sentPlain = plainBillerName(billerName);
  const sentNormalized = normalizeBillerName(billerName);
  const plainOf = (listed: Biller) => plainBillerName(listed.billerName);
  const normOf = (listed: Biller) => normalizeBillerName(listed.billerName);
  const decorated = (listed: Biller, name: string, sent: string) => {
    const path = decoratedRemainder(name, sent);
    return path !== null && acceptsPath(listed, path) ? name.length : 0;
  };
  // Each tier scores a listed biller: 0 = no match, higher = more specific;
  // among decorated matches (plain or provider-stripped) only the longest
  // listed name counts.
  // Exact names (plain, then provider-stripped) are resolved before any
  // decorated prefix, so "DSTV - PREMIUM (Kuda)" shown as "DSTV - PREMIUM"
  // is never captured as a "PREMIUM" path under a plain "DSTV".
  const tiers: Array<(listed: Biller) => number> = [
    (listed) => (plainOf(listed) === sentPlain ? 1 : 0),
    (listed) =>
      normOf(listed) !== '' && normOf(listed) === sentNormalized ? 1 : 0,
    // One decorated tier for both forms, so a longer provider-tagged biller
    // ("DSTV - PREMIUM (Kuda)") beats a shorter plain one ("DSTV").
    (listed) =>
      Math.max(
        decorated(listed, plainOf(listed), sentPlain),
        decorated(listed, normOf(listed), sentNormalized)
      ),
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
