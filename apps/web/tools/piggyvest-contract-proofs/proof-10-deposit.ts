import { AMOUNTS_KOBO } from './constants';
import { measureDeposit } from './deposit-measure';
import { answerOf, type ProofBuilder } from './proof-builder';
import type { ProofContext } from './proof-context';
import type { Answer } from './types';

/**
 * S8, step 2: a bank deposit (the sandbox test-funding stand-in) into the main
 * wallet is credited exactly once. "Once" is a balance fact: the settled
 * balance rose by the gross, or by the gross minus the fee the record shows,
 * and never by more than the gross (a double credit would exceed it).
 */

export const DEPOSIT_ONCE = 's8_deposit_credited_once';
const QUESTION =
  'Is a bank deposit into the main wallet credited exactly once?';

export function creditedOnce(
  grossKobo: number,
  creditedKobo: number,
  feeKobo: number | null
): Answer {
  if (creditedKobo > grossKobo) return 'no';
  if (creditedKobo === grossKobo) return 'yes';
  return feeKobo === null
    ? 'unknown'
    : answerOf(creditedKobo === grossKobo - feeKobo);
}

export async function stepDeposit(
  ctx: ProofContext,
  b: ProofBuilder,
  main: string
): Promise<void> {
  const gross = AMOUNTS_KOBO.s8DepositMain;
  const measured = await measureDeposit(ctx, main, gross, 'p10/deposit_main');
  if (measured.kind === 'resumed') {
    b.note(
      `The S8 deposit slot was already used (${measured.priorOutcome}); it is never resent. Use --new-attempt to repeat it.`
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
  b.finding(
    DEPOSIT_ONCE,
    QUESTION,
    creditedOnce(gross, measured.creditedKobo, fee),
    fee === null && measured.creditedKobo < gross
      ? 'the credit is below the gross and no fee was read from the record'
      : undefined
  );
}
