import { MovementLedger } from './movement-ledger';
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
import { emptyScenarioState, type ProofContext } from './proof-context';
import { qaIdentityFor } from './provider-ops';
import { proof10Key } from './qa-keys';
import { setupScenario } from './scenario';
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
 * Proof 10 measures money on its own wallets. Anything proofs 1 to 9 left
 * moving on the shared scenario's wallets (a late deposit, a pending
 * transfer) could land inside its measurements, so it never uses them: its
 * own QA customer, main wallet and goal wallet are created per attempt under
 * a key derived from the selected one, and journaled like any other
 * mutation. Read-only runs have nothing to measure and keep the shared view.
 */
async function dedicatedContext(
  shared: ProofContext,
  b: ProofBuilder,
  ledger: MovementLedger
): Promise<ProofContext> {
  if (shared.mode === 'live-readonly') return shared;
  const qa = qaIdentityFor(proof10Key(shared.qa.qaKey, shared.attempt));
  for (const value of [qa.qaKey, qa.thirdPartyIdentifier, qa.goalWalletName]) {
    shared.redactor.register('Q', value);
  }
  // The gate authorizes wallets through the shared set: the dedicated
  // customer's wallets join it, nothing else changes.
  const ctx: ProofContext = {
    ...shared,
    qa,
    state: { ...emptyScenarioState(), authorized: shared.state.authorized },
  };
  // Its setup funding is a movement like any other: unsettled, it would
  // land inside the deposit step's measurement.
  await setupScenario(ctx, ledger);
  for (const note of ctx.state.notes) b.note(note);
  return ctx;
}

/**
 * Proof 10 (task S8): the owner's first sandbox pass as one section of the
 * evidence. It runs after the shared scenario (customer, main wallet, goal
 * wallet, funded main) and every mutation is journaled, capped and never
 * resent. A dry run proves the logic against the mock; the same code runs
 * unchanged against the live sandbox with --live-sandbox-mutations.
 */
export async function runProof10(shared: ProofContext): Promise<ProofResult> {
  const b = new ProofBuilder('p10', TITLE);
  const ledger = new MovementLedger();
  const ctx = await dedicatedContext(shared, b, ledger);
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

  // One ledger for the whole sequence (setup funding included): every step
  // appends its movement, and a step measuring a wallet with an unsettled
  // movement publishes unknown for its money verdicts.
  await stepDeposit(ctx, b, main, ledger);
  const fund = await stepFundGoal(ctx, b, main, goal, ledger);
  await stepDoubleTap(ctx, b, main, goal, fund, ledger);
  await stepTimeoutRetry(ctx, b, main, goal, ledger);
  return b.build(ctx);
}
