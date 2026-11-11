/**
 * True when the outstanding captures exceed what the order recorded as paid
 * (or the recorded amount is missing/unreadable), mirroring the worker's
 * preflightCancellationRefundInitiation quarantine. A zero (never stamped)
 * paid total derives from the funded legs like effective_amount_paid_v1, so
 * a legacy order is not flagged for it. All values are integer minor units.
 */
export function exceedsRecordedPaid({
  amountPaid,
  derivedPaidMinor,
  outstandingMinor,
}: {
  amountPaid: number | null;
  derivedPaidMinor: number;
  outstandingMinor: number;
}): boolean {
  if (amountPaid === null || !Number.isFinite(amountPaid)) return true;
  const recordedMinor = Math.round(amountPaid * 100);
  const capMinor = recordedMinor === 0 ? derivedPaidMinor : recordedMinor;
  return outstandingMinor > capMinor;
}
