import { DEPOSIT_ONCE, stepDeposit } from './proof-10-deposit';
import {
  FUND_GOAL,
  stepDoubleTap,
  stepFundGoal,
  TAP_ONCE,
  TAP_SENDS_ONCE,
} from './proof-10-fund-double-tap';
import {
  NOT_FOUND_UNCERTAIN,
  stepTimeoutRetry,
  TIMEOUT_BOOKED_ONCE,
  TIMEOUT_INDETERMINATE,
  TIMEOUT_TSQ_FIRST,
} from './proof-10-timeout-retry';
import { ProofBuilder } from './proof-builder';
import type { ProofContext } from './proof-context';
import type { Answer, ProofResult } from './types';

const TITLE =
  'S8 first pass: onboard, deposit, create goal, fund, double tap, timeout retry';

const ONBOARD = 's8_onboard_customer_and_main_wallet';
const GOAL = 's8_goal_wallet_created';

const MUTATING: ReadonlyArray<readonly [string, string]> = [
  [
    DEPOSIT_ONCE,
    'Is a bank deposit into the main wallet credited exactly once?',
  ],
  [FUND_GOAL, 'Does funding the goal from main move the money exactly once?'],
  [TAP_SENDS_ONCE, 'Does a second tap send nothing new from the app?'],
  [TAP_ONCE, 'Does a double tap yield exactly one provider transfer?'],
  [
    TIMEOUT_INDETERMINATE,
    'Is a lost submit response recorded as indeterminate?',
  ],
  [TIMEOUT_TSQ_FIRST, 'Is the status checked before any resend?'],
  [NOT_FOUND_UNCERTAIN, 'Is a 404 right after submit treated as uncertain?'],
  [TIMEOUT_BOOKED_ONCE, 'Was the timed-out transfer booked exactly once?'],
];

/** Missing scenario state may be an unreadable setup, not a proven absence. */
function unreadableAsUnknown(established: boolean): Answer {
  return established ? 'yes' : 'unknown';
}

/**
 * Proof 10 (task S8): the owner's first sandbox pass as one section of the
 * evidence. It runs after the shared scenario (customer, main wallet, goal
 * wallet, funded main) and every mutation is journaled, capped and never
 * resent. A dry run proves the logic against the mock; the same code runs
 * unchanged against the live sandbox with --live-sandbox-mutations.
 */
export async function runProof10(ctx: ProofContext): Promise<ProofResult> {
  const b = new ProofBuilder('p10', TITLE);
  const { state, mode } = ctx;
  const main = state.mainWalletId;
  const goal = state.goalWalletId;

  // 1. Onboard: the QA customer exists, with a main wallet proven QA-owned.
  b.finding(
    ONBOARD,
    'Is there a QA customer with a main wallet that belongs to it?',
    unreadableAsUnknown(
      state.customerId !== null && main !== null && state.authorized.has(main)
    )
  );
  b.value('onboard_main_wallet_basis', state.mainWalletBasis).value(
    'onboard_new_customer',
    state.createdNewCustomer
  );
  // 3. Create goal: a distinct goal wallet, also proven QA-owned.
  b.finding(
    GOAL,
    'Is there a goal wallet, distinct from main, that belongs to the QA customer?',
    goal !== null && goal === main
      ? 'no'
      : unreadableAsUnknown(
          goal !== null && goal !== main && state.authorized.has(goal)
        )
  );

  if (mode === 'live-readonly' || !main || !goal) {
    b.inconclusive(
      mode === 'live-readonly'
        ? 'the S8 money steps need --live-sandbox-mutations'
        : 'QA main/goal wallets unavailable'
    );
    for (const [id, question] of MUTATING) b.finding(id, question, 'unknown');
    return b.build(ctx);
  }

  await stepDeposit(ctx, b, main);
  const fund = await stepFundGoal(ctx, b, main, goal);
  await stepDoubleTap(ctx, b, main, goal, fund);
  await stepTimeoutRetry(ctx, b, main, goal);
  return b.build(ctx);
}
