/**
 * Purchase readiness: spendable kobo covers the applicable price. Pending
 * interest is never spendable — callers must pass purchasing power, not
 * ledger balances.
 */
import { assertKobo } from './assert-kobo';
import { assertPositiveKobo } from './assert-positive-kobo';

export function isReady(
  spendableKobo: number,
  applicablePrice: number
): boolean {
  assertKobo(spendableKobo, 'spendableKobo');
  // A zero or missing price must never read ready: it would mark an
  // unfunded plan ready, so prices stay positive-only like every other
  // price-taking policy module.
  assertPositiveKobo(applicablePrice, 'applicablePrice');
  return spendableKobo >= applicablePrice;
}
