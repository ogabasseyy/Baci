import type { UtilityVoucherBackfill } from './utility-voucher-backfill-model';

// Terminality for the utility voucher backfill loop.
//
// Split from `utility-voucher-backfill-model.ts` (Codex R112 P1 — one
// primary export per file). Deciding "done" is separate from parsing
// the observation: the loop parses every poll but stops only here.
export function isTerminalBackfill(
  backfill: UtilityVoucherBackfill,
  tokenExpected: boolean
): boolean {
  if (backfill.pin !== null) {
    return true;
  }
  if (backfill.successful) {
    return !tokenExpected;
  }
  return (
    backfill.failed && (backfill.refundConfirmed || backfill.refundSkipped)
  );
}
