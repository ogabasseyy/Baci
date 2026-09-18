/**
 * Spendable purchasing power: confirmed principal plus verified paid
 * interest. Pending interest is never spendable.
 */
import { assertKobo } from './kobo-validators';

export function purchasingPowerKobo(
  principalKobo: number,
  paidInterestKobo: number
): number {
  assertKobo(principalKobo, 'principalKobo');
  assertKobo(paidInterestKobo, 'paidInterestKobo');
  return principalKobo + paidInterestKobo;
}
