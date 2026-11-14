import { AMOUNTS_KOBO } from './constants';
import { readTransferFeeKobo } from './debit-once';
import { settledAfterMovement } from './movement';
import { EARLIER_UNSETTLED, MovementLedger } from './movement-ledger';
import { awaitTerminal, delta, readingOf, settledWallets } from './poll';
import type { ProofBuilder } from './proof-builder';
import type { ProofContext } from './proof-context';
import { oneFullTransferLanded } from './settle-rule';
import { transferVerdict } from './verdict-rule';

export {
  stepDoubleTap,
  TAP_ONCE,
  TAP_SENDS_ONCE,
} from './proof-10-double-tap';

/**
 * S8, steps 4 and 5: fund the goal wallet from the main wallet, then tap the
 * same action a second time. A double tap must yield exactly ONE provider
 * transfer, so both layers are measured: the app path (the same slot sends
 * nothing the second time) and the wire (the SAME reference sent again must
 * not debit twice or add a second record). Whatever the provider does with a
 * repeated reference is recorded, but production never relies on it.
 */

export const FUND_GOAL = 's8_fund_goal_moves_money_once';

const FUND_Q =
  'Does funding the goal from main debit main once and credit the goal once?';
export interface FundGoalResult {
  reference: string;
  amountKobo: number;
  sendAccepted: boolean;
  /** True only when the original funding reached a terminal success. */
  terminalSuccess: boolean;
  /** Settled main balance after the funding; null if it never settled. */
  mainBalanceKobo: number | null;
  /** Settled goal balance after the funding; null if it never settled. */
  goalBalanceKobo: number | null;
  mainDeltaKobo: number | null;
  goalDeltaKobo: number | null;
}

export async function stepFundGoal(
  ctx: ProofContext,
  b: ProofBuilder,
  main: string,
  goal: string,
  ledger: MovementLedger = new MovementLedger()
): Promise<FundGoalResult | null> {
  const { api, qa, redactor } = ctx;
  const amount = AMOUNTS_KOBO.s8FundGoal;
  const baseline = await settledWallets(ctx, [main, goal]);
  const sent = await api.transferWallet(
    qa,
    main,
    goal,
    amount,
    'p10/fund_goal'
  );
  redactor.register('R', sent.reference);
  // A send whose result is not read to completion may still move both
  // wallets under a later baseline.
  const quietBefore = ledger.isQuiet(main, goal);
  const record = (settled: boolean) =>
    ledger.append({ from: main, to: goal, amountKobo: amount, settled });
  if (sent.kind === 'resumed') {
    record(false);
    b.note(
      `The S8 fund-goal slot was already used (${sent.priorOutcome}); it is never resent. Repeating it needs a full run without the --proof p10 filter, using --new-attempt.`
    );
    b.inconclusive('S8 goal funding already executed in an earlier run');
    b.finding(FUND_GOAL, FUND_Q, 'unknown');
    return null;
  }
  b.value('fund_goal_http_status', sent.call.httpStatus).value(
    'fund_goal_outcome',
    sent.outcome
  );
  const result: FundGoalResult = {
    reference: sent.reference,
    amountKobo: amount,
    sendAccepted: sent.outcome === 'accepted',
    terminalSuccess: false,
    mainBalanceKobo: null,
    goalBalanceKobo: null,
    mainDeltaKobo: null,
    goalDeltaKobo: null,
  };
  if (!sent.call.ok) {
    // Only a definite decline proves nothing moved.
    if (sent.outcome !== 'rejected') record(false);
    b.inconclusive('the goal funding transfer was not accepted');
    b.finding(FUND_GOAL, FUND_Q, 'unknown', 'the transfer was not accepted');
    return result;
  }
  const watch = await awaitTerminal(
    ctx,
    sent.reference,
    main,
    await api.verify(sent.reference, main)
  );
  // Both balances must SHOW the transfer: a lagging, unchanged balance is not
  // a settled result.
  const after = await settledAfterMovement(ctx, [main, goal], baseline, [
    main,
    goal,
  ]);
  const measured = baseline.settled && after.settled && after.moved;
  result.mainBalanceKobo = after.settled
    ? readingOf(after, main).balance
    : null;
  result.goalBalanceKobo = after.settled
    ? readingOf(after, goal).balance
    : null;
  result.mainDeltaKobo = measured
    ? delta(readingOf(baseline, main).balance, readingOf(after, main).balance)
    : null;
  result.goalDeltaKobo = measured
    ? delta(readingOf(baseline, goal).balance, readingOf(after, goal).balance)
    : null;
  result.terminalSuccess = watch.terminal === 'success';
  b.value('fund_goal_terminal', watch.terminal)
    .value('fund_goal_main_delta_kobo', result.mainDeltaKobo)
    .value('fund_goal_goal_delta_kobo', result.goalDeltaKobo);
  const { mainDeltaKobo: main$, goalDeltaKobo: goal$ } = result;
  // One transfer takes the amount plus, at most, the fee the record shows,
  // on either side. A difference the record cannot explain is never "once".
  const fee =
    watch.terminal === 'success' && main$ !== null && goal$ !== null
      ? await readTransferFeeKobo(ctx, sent.reference, main)
      : null;
  // Settled by the shared rule: debit and credit each equal ONE transfer
  // (the amount within its own recorded fee); an over-credit is not settled.
  record(
    watch.terminal === 'success' &&
      main$ !== null &&
      goal$ !== null &&
      oneFullTransferLanded(amount, -main$, goal$, fee)
  );
  if (watch.terminal !== 'success' || main$ === null || goal$ === null) {
    b.inconclusive('the goal funding did not reach a settled, measured result');
    b.finding(
      FUND_GOAL,
      FUND_Q,
      'unknown',
      watch.terminal !== 'success'
        ? 'the funding did not reach a terminal success'
        : 'the balances never showed the transfer within the polling budget'
    );
    return result;
  }
  if (!quietBefore) {
    // The baseline may already include part of an earlier movement, or the
    // earlier one may land during the measurement: they cannot be separated.
    b.inconclusive('an earlier step left these wallets unsettled');
    b.finding(FUND_GOAL, FUND_Q, 'unknown', EARLIER_UNSETTLED);
    return result;
  }
  b.value('fund_goal_fee_from_record_kobo', fee);
  const verdict = transferVerdict(amount, -main$, goal$, fee);
  b.finding(FUND_GOAL, FUND_Q, verdict.answer, verdict.detail);
  return result;
}
