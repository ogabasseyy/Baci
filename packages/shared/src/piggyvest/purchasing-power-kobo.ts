/**
 * Spendable purchasing power: confirmed principal plus verified paid
 * interest. Pending interest is never spendable.
 */
import { assertKobo } from './assert-kobo';

export function purchasingPowerKobo(
  principalKobo: number,
  paidInterestKobo: number
): number {
  assertKobo(principalKobo, 'principalKobo');
  assertKobo(paidInterestKobo, 'paidInterestKobo');
  // Individually safe operands can still sum past MAX_SAFE_INTEGER; a
  // rounded total would then fail downstream safe-integer checks (or worse,
  // silently misstate spendable funds), so validate the sum itself.
  const totalKobo = principalKobo + paidInterestKobo;
  assertKobo(totalKobo, 'purchasingPowerKobo total');
  return totalKobo;
}
