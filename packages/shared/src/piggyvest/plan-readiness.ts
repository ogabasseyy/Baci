/**
 * Purchase readiness: spendable kobo covers the applicable price. Pending
 * interest is never spendable — callers must pass purchasing power, not
 * ledger balances.
 */
import { assertKobo } from './kobo-validators';

export function isReady(
  spendableKobo: number,
  applicablePrice: number
): boolean {
  assertKobo(spendableKobo, 'spendableKobo');
  assertKobo(applicablePrice, 'applicablePrice');
  return spendableKobo >= applicablePrice;
}
