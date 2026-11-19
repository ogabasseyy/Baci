import { AMOUNTS_KOBO } from './constants';
import { measureDeposit } from './deposit-measure';
import { EARLIER_UNSETTLED, MovementLedger } from './movement-ledger';
import type { ProofBuilder } from './proof-builder';
import type { ProofContext } from './proof-context';
import { creditedOnce } from './verdict-rule';

/**
 * S8, step 2: a bank deposit (the sandbox test-funding stand-in) into the main
 * wallet is credited exactly once. "Once" is a balance fact: the settled
 * balance rose by the gross, or by the gross minus the fee the record shows,
 * and never by more than the gross (a double credit would exceed it).
 */

export { creditedOnce };
export const DEPOSIT_ONCE = 's8_deposit_credited_once';
const QUESTION =
  'Is a bank deposit into the main wallet credited exactly once?';

export async function stepDeposit(
  ctx: ProofContext,
  b: ProofBuilder,
  main: string,
  ledger: MovementLedger = new MovementLedger()
): Promise<void> {
  const gross = AMOUNTS_KOBO.s8DepositMain;
  // Setup funding (or anything else) still unsettled on main would land
  // inside this deposit's measurement.
  const quietBefore = ledger.isQuiet(main);
  const measured = await measureDeposit(ctx, main, gross, 'p10/deposit_main');
  // Unmeasured or only partly credited, the rest may still land under a
  // later baseline: settled needs the full expected credit (settle-rule.ts).
  ledger.append({
    from: null,
    to: main,
    amountKobo: gross,
    settled: measured.kind === 'measured' && measured.complete,
  });
  if (measured.kind === 'resumed') {
    b.note(
      `The S8 deposit slot was already used (${measured.priorOutcome}); it is never resent. Repeating it needs a full run without the --proof p10 filter, using --new-attempt.`
    );
    b.inconclusive('S8 deposit already executed in an earlier run');
    b.finding(DEPOSIT_ONCE, QUESTION, 'unknown');
    return;
  }
  b.value('deposit_funding_http_status', measured.fundingHttpStatus).value(
    'deposit_funding_outcome',
    measured.fundingOutcome
  );
  if (measured.kind === 'unsettled') {
    b.inconclusive(measured.reason);
    b.finding(DEPOSIT_ONCE, QUESTION, 'unknown', measured.reason);
    return;
  }
  const fee = measured.facts.feeKobo;
  b.value('deposit_gross_kobo', gross)
    .value('deposit_credited_kobo', measured.creditedKobo)
    .value('deposit_fee_from_record_kobo', fee)
    .value('deposit_row_found', measured.row !== null);
  if (!quietBefore) {
    // The raw values above stay published for the human review.
    b.inconclusive('an earlier step left the main wallet unsettled');
    b.finding(DEPOSIT_ONCE, QUESTION, 'unknown', EARLIER_UNSETTLED);
    return;
  }
  b.finding(
    DEPOSIT_ONCE,
    QUESTION,
    creditedOnce(gross, measured.creditedKobo, fee),
    fee === null && measured.creditedKobo < gross
      ? 'the credit is below the gross and no fee was read from the record'
      : undefined
  );
}
