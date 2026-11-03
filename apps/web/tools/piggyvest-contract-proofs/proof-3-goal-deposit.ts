import { AMOUNTS_KOBO } from './constants';
import { pickString } from './loose-schemas';
import { delta, readingOf, settledWallets } from './poll';
import { answerOf, ProofBuilder } from './proof-builder';
import type { ProofContext } from './proof-context';
import type { CallResult } from './provider-ops';
import { pollSettled, recordOf, usableList } from './read-rules';
import { analyseRecord, relationOfCredit } from './tsq-analysis';
import type { ProofResult } from './types';

const TITLE = "Bank deposit into a goal sub-wallet's own virtual account";

/**
 * Whatever an accounts read returned is registered with the redactor (a
 * failed body may still hold real numbers), but only a successful read yields
 * numbers to reason about.
 */
function accountNumbers(ctx: ProofContext, call: CallResult): string[] {
  const entries = Array.isArray(call.data) ? call.data : [];
  for (const entry of entries) {
    ctx.redactor.register('A', pickString(entry, ['account_number']));
    ctx.redactor.register('N', pickString(entry, ['account_name']));
  }
  if (!call.ok) return [];
  return entries
    .map((entry) => pickString(entry, ['account_number']))
    .filter((n): n is string => n !== null);
}

/**
 * The credit row for THIS deposit: its amount equals the gross sent or the
 * measured credit. Never "the newest credit": proof 2 leaves another credit
 * on the same wallet and a wrong row would corrupt every downstream fact.
 */
export function selectDepositRow(
  credits: unknown[],
  grossKobo: number,
  creditedKobo: number | null,
  excludeIds: ReadonlySet<string> = new Set()
): unknown {
  return credits.find((edge) => {
    const record = edge as Record<string, unknown>;
    if (typeof record.id === 'string' && excludeIds.has(record.id))
      return false;
    return (
      record.amount === grossKobo ||
      (creditedKobo !== null && record.amount === creditedKobo)
    );
  });
}

const DEPOSIT_QUESTIONS: ReadonlyArray<readonly [string, string]> = [
  [
    'credited_to_goal_wallet',
    'Is the deposit credited to the goal sub-wallet?',
  ],
  [
    'main_wallet_unchanged',
    'Is the main wallet balance unchanged by the goal deposit?',
  ],
  [
    'transaction_list_names_goal_wallet',
    'Does the goal wallet transaction list show a credit row naming the goal wallet?',
  ],
  [
    'main_wallet_list_excludes_deposit_row',
    'Is the deposit row absent from the main wallet transaction list?',
  ],
  [
    'single_transaction_names_destination_wallet',
    'Does GET /transaction/:id name the goal wallet as destination?',
  ],
];

export async function runProof3(ctx: ProofContext): Promise<ProofResult> {
  const { api, qa, state, mode } = ctx;
  const b = new ProofBuilder('p3', TITLE);
  const goal = state.goalWalletId;
  const main = state.mainWalletId;
  if (!goal || !main) {
    return b.inconclusive('QA main/goal wallets unavailable').build(ctx);
  }

  // A. Virtual accounts (GET: every live mode).
  const goalAccounts = await api.walletAccounts(goal);
  const mainAccounts = await api.walletAccounts(main);
  b.shape(
    'GET /wallet/:id/accounts',
    goalAccounts.httpStatus,
    goalAccounts.data
  );
  const goalNumbers = accountNumbers(ctx, goalAccounts);
  const mainNumbers = accountNumbers(ctx, mainAccounts);
  // Absence needs a successful read of a recognised list (an array of accounts).
  const goalAccountsUsable =
    goalAccounts.ok && Array.isArray(goalAccounts.data);
  const mainAccountsUsable =
    mainAccounts.ok && Array.isArray(mainAccounts.data);
  b.value('goal_account_count', goalAccountsUsable ? goalNumbers.length : null);
  b.finding(
    'goal_wallet_has_own_virtual_account',
    'Does the goal sub-wallet have its own virtual account?',
    goalAccountsUsable ? answerOf(goalNumbers.length > 0) : 'unknown'
  );
  b.finding(
    'goal_account_differs_from_main',
    'Is the goal account number different from the main wallet account number?',
    goalAccountsUsable &&
      mainAccountsUsable &&
      goalNumbers.length > 0 &&
      mainNumbers.length > 0
      ? answerOf(!goalNumbers.some((n) => mainNumbers.includes(n)))
      : 'unknown'
  );

  // B. The deposit. The sandbox stand-in for a bank transfer is the test-funding API.
  b.unobservable(
    'webhook_names_goal_wallet',
    'Does the bank-inflow webhook name the goal wallet?',
    'The harness has no receiver. Confirm from the durable inbox which field names the credited wallet (pvb_wallet vs eventData.destination_wallet_id); see docs/piggyvest-contract-register.md section 7.'
  );
  b.note(
    'Assumption: test funding (POST /transfer/test/funding) stands in for a bank transfer to the virtual account number; PiggyVest exposes no API to push a real transfer to that number.'
  );
  if (mode === 'live-readonly') {
    b.inconclusive('deposit step needs --live-sandbox-mutations');
    for (const [id, question] of DEPOSIT_QUESTIONS)
      b.finding(id, question, 'unknown');
    return b.build(ctx);
  }

  const gross = AMOUNTS_KOBO.fundGoal;
  // A clean baseline: a balance still lagging an earlier transfer would put
  // that transfer into this deposit's credit.
  const baseline = await settledWallets(ctx, [goal, main]);
  const before = {
    goal: readingOf(baseline, goal),
    main: readingOf(baseline, main),
  };
  // Rows that exist before this deposit can never be "this deposit's row".
  const priorList = usableList(
    await api.transactions({ wallet_id: goal, limit: '20' })
  );
  const priorRowIds = new Set(
    (priorList?.edges ?? [])
      .map((edge) => pickString(edge, ['id']))
      .filter((id): id is string => id !== null)
  );
  const funded = await api.fundWallet(qa, goal, gross, 'p3/fund_goal');
  if (funded.kind === 'resumed') {
    b.inconclusive('funding already executed in an earlier run');
    b.note(
      `The funding slot was already used (${funded.priorOutcome}); it is never resent. Use --new-attempt to repeat it.`
    );
    for (const [id, question] of DEPOSIT_QUESTIONS)
      b.finding(id, question, 'unknown');
    return b.build(ctx);
  }
  b.value('funding_http_status', funded.call.httpStatus).value(
    'funding_outcome',
    funded.outcome
  );

  const result = await settledWallets(ctx, [goal, main]);
  const after = {
    goal: readingOf(result, goal),
    main: readingOf(result, main),
  };
  const credited = delta(before.goal.balance, after.goal.balance);
  const mainDelta = delta(before.main.balance, after.main.balance);
  const balancesSettled = baseline.settled && result.settled;
  const settled = balancesSettled && credited !== null && credited > 0;
  if (!settled) {
    b.inconclusive(
      balancesSettled
        ? 'the deposit did not settle within the polling window'
        : 'the balances were still moving, so no clean credit could be measured'
    );
    b.note(
      'A non-settling sandbox funding call has been seen before (17 Sep); this is not evidence that goal deposits are not credited.'
    );
    for (const [id, question] of DEPOSIT_QUESTIONS)
      b.finding(id, question, 'unknown');
    return b.build(ctx);
  }
  b.finding('credited_to_goal_wallet', DEPOSIT_QUESTIONS[0][1], 'yes');
  b.finding(
    'main_wallet_unchanged',
    DEPOSIT_QUESTIONS[1][1],
    answerOf(mainDelta === null ? null : mainDelta === 0)
  );

  // The new row may not be indexed yet: poll the goal list within the budget.
  const creditRows = (call: Awaited<ReturnType<typeof api.transactions>>) =>
    (usableList(call)?.edges ?? []).filter(
      (edge) => pickString(edge, ['type']) === 'credit'
    );
  const pick = (call: Awaited<ReturnType<typeof api.transactions>>) =>
    priorList
      ? selectDepositRow(creditRows(call), gross, credited, priorRowIds)
      : undefined;
  const polled = await pollSettled(
    ctx,
    () => api.transactions({ wallet_id: goal, limit: '20' }),
    (call) => pick(call) !== undefined
  );
  const goalList = polled.value;
  const row = pick(goalList);
  const rowId = pickString(row, ['id']);
  const noRowDetail = !priorList
    ? "the list of earlier rows could not be read, so this deposit's row cannot be told apart from older ones"
    : usableList(goalList)
      ? `no credit row matched the gross or the measured credit within ${polled.polls} reads (not indexed yet, or recorded differently); no row was guessed`
      : 'the goal-wallet transaction list could not be read';
  b.finding(
    DEPOSIT_QUESTIONS[2][0],
    DEPOSIT_QUESTIONS[2][1],
    row ? answerOf(pickString(row, ['wallet_id']) === goal) : 'unknown',
    row ? undefined : noRowDetail
  );
  if (!row) b.inconclusive('the deposit row was not observed');
  b.value('deposit_row_category', pickString(row, ['category']));
  b.value('deposit_row_status', pickString(row, ['status']));
  b.shape(
    'GET /transaction (goal wallet credit row)',
    goalList.httpStatus,
    row
  );

  // "Absent from the main wallet" needs a successful read of a recognised list.
  const mainList = usableList(
    await api.transactions({ wallet_id: main, limit: '20' })
  );
  if (rowId && !mainList) {
    b.inconclusive('the main-wallet transaction list could not be read');
  }
  b.finding(
    DEPOSIT_QUESTIONS[3][0],
    DEPOSIT_QUESTIONS[3][1],
    rowId && mainList
      ? answerOf(
          !mainList.edges.some((edge) => pickString(edge, ['id']) === rowId)
        )
      : 'unknown',
    rowId && !mainList
      ? 'the main-wallet transaction list could not be read or has an unrecognised shape'
      : undefined
  );

  const single = rowId ? await api.transaction(rowId, goal) : null;
  const singleRecord = single ? recordOf(single) : null;
  const facts = analyseRecord(singleRecord, {
    sourceWalletId: null,
    destinationWalletId: goal,
    amountKobo: gross,
  });
  if (single)
    b.shape('GET /transaction/:id (deposit)', single.httpStatus, single.data);
  b.finding(
    DEPOSIT_QUESTIONS[4][0],
    DEPOSIT_QUESTIONS[4][1],
    singleRecord ? answerOf(facts.namesDestination) : 'unknown',
    facts.destinationKey ? `field: ${facts.destinationKey}` : undefined
  );
  b.value('deposit_fee_kobo_in_record', facts.feeKobo);
  b.value(
    'deposit_credit_relation',
    relationOfCredit(gross, credited, facts.feeKobo)
  );
  state.deposit = {
    grossKobo: gross,
    creditedKobo: credited,
    feeFromRecordKobo: facts.feeKobo,
    feeFieldPresent: singleRecord ? facts.hasFee : null,
  };
  return b.build(ctx);
}
