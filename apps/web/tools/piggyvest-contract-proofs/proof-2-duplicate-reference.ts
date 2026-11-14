import { pickString } from './loose-schemas';
import { delta, readingOf, settledWallets, statusOf } from './poll';
import { answerOf, type ProofBuilder } from './proof-builder';
import type { ProofContext } from './proof-context';
import type { CallResult } from './provider-ops';
import { pollSettled, usableList } from './read-rules';

/**
 * Proof 2, added step: what does POST /transfer/wallet do with a reference
 * it has already settled? The same body and the SAME reference as proof 2's
 * own transfer are sent once more, in a slot of their own, and the answer,
 * the source balance and the source record list are measured. Until
 * PiggyVest confirms the behaviour in writing, production never resubmits a
 * reference (a failed or uncertain transfer is released and any retry uses a
 * new reference); this only records what the sandbox does.
 */

const QUESTIONS: ReadonlyArray<readonly [string, string]> = [
  [
    'duplicate_reference_rejected',
    'Is a second wallet transfer with an already-used reference rejected?',
  ],
  [
    'duplicate_reference_moves_money_again',
    'Does the repeat debit the source wallet a second time?',
  ],
  [
    'duplicate_reference_second_record',
    'Does the source wallet list show a second record with the same reference?',
  ],
];

function allUnknown(b: ProofBuilder, reason: string): void {
  b.inconclusive(reason);
  for (const [id, question] of QUESTIONS) b.finding(id, question, 'unknown');
}

export async function runDuplicateReference(
  ctx: ProofContext,
  b: ProofBuilder
): Promise<void> {
  const { api, qa, state, mode, redactor } = ctx;
  const first = state.walletTransfer;
  const main = state.mainWalletId;
  const goal = state.goalWalletId;
  if (mode === 'live-readonly')
    return allUnknown(
      b,
      'the duplicate-reference re-send needs --live-sandbox-mutations'
    );
  if (!main || !goal || !first?.reference || first.terminal !== 'success')
    return allUnknown(b, 'no settled proof 2 transfer to repeat');
  // Mirrors the gate's accepted-reference rule, so the gate stays a backstop
  // and is never tripped on a predictable condition.
  if (first.sendAccepted !== true)
    return allUnknown(
      b,
      'the proof 2 transfer was not journaled accepted (indeterminate or unresolved); its reference is never re-sent'
    );
  const reference = first.reference;

  const countRows = (call: CallResult): number | null => {
    const list = usableList(call);
    return list
      ? list.edges.filter(
          (edge) => pickString(edge, ['third_party_reference']) === reference
        ).length
      : null;
  };
  const listMain = () => api.transactions({ wallet_id: main, limit: '50' });
  const baseline = await settledWallets(ctx, [main, goal]);
  // The original row can be indexed late: wait for it, so a row that only
  // appears after the repeat is never mistaken for a second record. Without a
  // baseline the record question stays unknown.
  const original = await pollSettled(
    ctx,
    listMain,
    (list) => (countRows(list) ?? 0) >= 1
  );
  const rowsBefore = original.settled ? countRows(original.value) : null;

  const again = await api.transferWalletAgain(
    qa,
    main,
    goal,
    first.amountKobo,
    reference,
    'p2/duplicate_reference',
    'p2/w2w'
  );
  if (again.kind === 'resumed') {
    b.note(
      `The duplicate-reference slot was already used (${again.priorOutcome}); it is never resent. Use --new-attempt to repeat it.`
    );
    return allUnknown(
      b,
      'duplicate-reference re-send already executed in an earlier run'
    );
  }
  const { call, outcome } = again;
  b.shape(
    'POST /transfer/wallet (same reference again)',
    call.httpStatus,
    call.envelope
  );
  b.value('duplicate_http_status', call.httpStatus)
    .value('duplicate_outcome', outcome)
    .value(
      'duplicate_message',
      call.message ? redactor.message(call.message) : null
    );
  b.finding(
    QUESTIONS[0][0],
    QUESTIONS[0][1],
    outcome === 'rejected' ? 'yes' : outcome === 'accepted' ? 'no' : 'unknown'
  );

  // The status of the reference straight after the repeat (also lets an
  // accepted repeat progress before the balances are read).
  b.value(
    'tsq_after_duplicate_status',
    statusOf(await api.verify(reference, main))
  );
  // An accepted repeat follows the provider's own pending/not-found lifecycle,
  // and only status checks advance it: keep checking for the whole budget.
  if (outcome === 'accepted') {
    for (let poll = 0; poll < ctx.maxPolls; poll += 1) {
      await ctx.sleep(ctx.pollIntervalMs);
      await api.verify(reference, main);
    }
  }
  // A second debit can lag: balances are read for the whole budget.
  const after = await settledWallets(ctx, [main, goal]);
  const sourceDelta =
    baseline.settled && after.settled
      ? delta(readingOf(baseline, main).balance, readingOf(after, main).balance)
      : null;
  b.value('duplicate_source_delta_kobo', sourceDelta);
  b.finding(
    QUESTIONS[1][0],
    QUESTIONS[1][1],
    sourceDelta === null ? 'unknown' : answerOf(sourceDelta < 0),
    sourceDelta === null
      ? 'the balances did not settle within the polling budget'
      : undefined
  );

  // An accepted repeat may be indexed late: wait for a second row within the budget.
  const listed = await pollSettled(
    { ...ctx, maxPolls: outcome === 'rejected' ? 0 : ctx.maxPolls },
    listMain,
    (list) => (countRows(list) ?? 0) > (rowsBefore ?? 0)
  );
  const rowsAfter = countRows(listed.value);
  b.value('rows_with_reference_before', rowsBefore).value(
    'rows_with_reference_after',
    rowsAfter
  );
  b.finding(
    QUESTIONS[2][0],
    QUESTIONS[2][1],
    rowsBefore === null || rowsAfter === null
      ? 'unknown'
      : answerOf(rowsAfter > rowsBefore),
    rowsBefore === null
      ? "the original transfer's row was not listed before the repeat, so there is no baseline"
      : undefined
  );
  b.note(
    'Duplicate reference: production never resubmits a reference until PiggyVest confirms this behaviour in writing; a failed or uncertain transfer is released and any retry uses a new reference.'
  );
}
