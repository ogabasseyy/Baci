import type { OxygenRuntimeSnapshot } from '@baci/shared/oxygen';
import type { OxygenConfirmedTerms } from './oxygen-plan';

/** Convert confirmed naira values to kobo without silently rounding. */
function kobo(value: number): bigint | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) return null;
  const result =
    BigInt(match[1]) * 100n + BigInt((match[2] ?? '0').padEnd(2, '0'));
  return result <= BigInt(Number.MAX_SAFE_INTEGER) ? result : null;
}

export function confirmedOxygenTerms(
  snapshot: OxygenRuntimeSnapshot
): OxygenConfirmedTerms | null {
  const booking = snapshot.state.booking;
  const schedule = snapshot.state.schedule;
  if (!booking || !schedule?.length) return null;
  const charges = booking.total_charges ?? snapshot.state.quotedCharges;
  if (charges == null) return null;
  let upfront = booking.total_upfront_payment;
  if (upfront == null) {
    const equityKobo = kobo(booking.equity_amount);
    const chargesKobo = kobo(charges);
    if (
      equityKobo === null ||
      chargesKobo === null ||
      equityKobo + chargesKobo > BigInt(Number.MAX_SAFE_INTEGER)
    )
      return null;
    upfront = Number(equityKobo + chargesKobo) / 100;
  }
  return {
    reference: booking.loan_reference,
    upfront,
    monthly: schedule[0].amount,
    charges,
    schedule: schedule.map((row) => ({
      period: row.period,
      date: row.dueDate.join('-'),
      amount: row.amount,
    })),
  };
}
