import { randomBytes } from 'node:crypto';
import { AMOUNTS_KOBO } from './constants';
import { pickString } from './loose-schemas';
import {
  awaitTerminal,
  delta,
  readingOf,
  readWallet,
  settledWallets,
  statusOf,
} from './poll';
import { answerOf, ProofBuilder } from './proof-builder';
import type { ProofContext } from './proof-context';
import {
  foundAnswer,
  isTransientFailure,
  pollSettled,
  recordOf,
  usableList,
} from './read-rules';
import { analyseRecord, statusVocabulary } from './tsq-analysis';
import type { ProofResult } from './types';

const TITLE = 'Transaction status query (TSQ) for a wallet-to-wallet transfer';

const UNKNOWN_QUESTIONS: ReadonlyArray<readonly [string, string]> = [
  ['tsq_shows_amount', 'Does the TSQ response show the amount?'],
  [
    'tsq_amount_matches_sent',
    'Does the TSQ amount equal the amount sent (kobo)?',
  ],
  ['tsq_shows_currency', 'Does the TSQ response show the currency?'],
  ['tsq_shows_fee', 'Does the TSQ response show a fee?'],
  ['tsq_shows_status', 'Does the TSQ response show a status?'],
  ['tsq_names_source_wallet', 'Does the TSQ response name the SOURCE wallet?'],
  [
    'tsq_names_destination_wallet',
    'Does the TSQ response name the DESTINATION wallet?',
  ],
  [
    'single_transaction_names_both_wallets',
    'Does GET /transaction/:id name both wallets?',
  ],
];

export async function runProof2(ctx: ProofContext): Promise<ProofResult> {
  const { api, qa, state, mode, redactor } = ctx;
  const b = new ProofBuilder('p2', TITLE);

  // A. Unknown reference (GET: allowed in every live mode).
  const unknown = await api.verify(
    `pvbproof-unknown-${randomBytes(6).toString('hex')}`
  );
  b.shape('GET TSQ (unknown reference)', unknown.httpStatus, unknown.envelope);
  b.value('unknown_reference_http_status', unknown.httpStatus);
  b.value(
    'unknown_reference_message',
    unknown.message ? redactor.message(unknown.message) : null
  );
  b.finding(
    'unknown_reference_is_404',
    'Does an unknown reference return HTTP 404?',
    isTransientFailure(unknown.httpStatus)
      ? 'unknown'
      : answerOf(unknown.httpStatus === 404),
    isTransientFailure(unknown.httpStatus)
      ? 'the request failed (gateway error, timeout or dropped connection); the status says nothing about the reference'
      : undefined
  );

  const main = state.mainWalletId;
  const goal = state.goalWalletId;
  if (mode === 'live-readonly' || !main || !goal) {
    b.inconclusive(
      mode === 'live-readonly'
        ? 'transfer step needs --live-sandbox-mutations'
        : 'QA main/goal wallets unavailable'
    );
    for (const [id, question] of UNKNOWN_QUESTIONS)
      b.finding(id, question, 'unknown');
    return b.build(ctx);
  }

  // B. A real wallet-to-wallet transfer, then TSQ on our own reference.
  const amount = AMOUNTS_KOBO.walletTransfer;
  // A clean baseline: balances that still lag an earlier transfer would put
  // that transfer's effect into this one's delta.
  const baseline = await settledWallets(ctx, [main, goal]);
  const before = {
    main: readingOf(baseline, main),
    goal: readingOf(baseline, goal),
  };
  const sent = await api.transferWallet(qa, main, goal, amount, 'p2/w2w');
  redactor.register('R', sent.reference);
  if (sent.kind === 'resumed') {
    b.inconclusive('transfer already executed in an earlier run');
    b.note(
      `The transfer slot was already used (${sent.priorOutcome}); it is never resent. Use --new-attempt to repeat it. Its journaled reference is queried read-only.`
    );
  } else {
    b.value('transfer_http_status', sent.call.httpStatus).value(
      'transfer_outcome',
      sent.outcome
    );
    if (!sent.call.ok) {
      b.inconclusive('transfer was not accepted');
      b.value(
        'transfer_rejection_message',
        sent.call.message ? redactor.message(sent.call.message) : null
      );
    }
  }

  const immediate = await api.verify(sent.reference, main);
  const immediateStatus = statusOf(immediate);
  b.shape(
    'GET TSQ (immediately after submit)',
    immediate.httpStatus,
    immediate.ok ? immediate.data : immediate.envelope
  );
  b.value('status_immediately_after_submit', immediateStatus);
  const watch = await awaitTerminal(ctx, sent.reference, main, immediate);
  const sequence = [immediateStatus, ...watch.statuses].filter(
    (status, i, all) => all.indexOf(status) === i
  );
  b.value('status_sequence', statusVocabulary(sequence))
    .value('terminal', watch.terminal)
    .value('polls_to_terminal', watch.polls);

  // Field findings need the SETTLED TSQ result: fields may only appear once the
  // transfer is terminal, so a pending record cannot establish their absence.
  const settledTsq =
    watch.terminal === 'success' && watch.lastOk ? watch.lastOk : null;
  const tsqRecord = settledTsq ? recordOf(settledTsq) : null;
  const facts = analyseRecord(tsqRecord, {
    sourceWalletId: main,
    destinationWalletId: goal,
    amountKobo: amount,
  });
  if (settledTsq && tsqRecord) {
    b.shape('GET TSQ (terminal)', settledTsq.httpStatus, settledTsq.data);
    b.value('tsq_field_names', facts.fieldNames.join(','));
    b.finding(
      'tsq_shows_amount',
      UNKNOWN_QUESTIONS[0][1],
      answerOf(facts.hasAmount)
    );
    b.finding(
      'tsq_amount_matches_sent',
      UNKNOWN_QUESTIONS[1][1],
      answerOf(facts.amountMatches)
    );
    b.finding(
      'tsq_shows_currency',
      UNKNOWN_QUESTIONS[2][1],
      answerOf(facts.hasCurrency)
    );
    b.finding('tsq_shows_fee', UNKNOWN_QUESTIONS[3][1], answerOf(facts.hasFee));
    b.finding(
      'tsq_shows_status',
      UNKNOWN_QUESTIONS[4][1],
      answerOf(facts.hasStatus)
    );
    b.finding(
      'tsq_names_source_wallet',
      UNKNOWN_QUESTIONS[5][1],
      answerOf(facts.namesSource),
      facts.sourceKey ? `field: ${facts.sourceKey}` : undefined
    );
    b.finding(
      'tsq_names_destination_wallet',
      UNKNOWN_QUESTIONS[6][1],
      answerOf(facts.namesDestination),
      facts.destinationKey ? `field: ${facts.destinationKey}` : undefined
    );
    b.finding(
      'existing_typed_tsq_schema_accepts_response',
      'Does the existing typed TSQ schema accept the live response?',
      answerOf(settledTsq.typedAccepted)
    );
  } else {
    b.inconclusive('the transfer did not reach a settled TSQ result');
    for (const [id, question] of UNKNOWN_QUESTIONS.slice(0, 7))
      b.finding(id, question, 'unknown');
  }
  // A filtered lookup is only meaningful once the reference is known to exist.
  const filtered = async (walletId: string) =>
    settledTsq
      ? foundAnswer(await api.verify(sent.reference, walletId))
      : 'unknown';
  b.finding(
    'tsq_found_with_source_wallet_filter',
    'Is the reference found when narrowed by the source wallet?',
    await filtered(main)
  );
  b.finding(
    'tsq_found_with_destination_wallet_filter',
    'Is the reference found when narrowed by the destination wallet?',
    await filtered(goal)
  );

  // C. Fallback evidence: the single-transaction record, found via the list.
  // The new row may not be indexed yet, so poll within the budget.
  const findRow = (call: Awaited<ReturnType<typeof api.transactions>>) =>
    usableList(call)?.edges.find(
      (edge) => pickString(edge, ['third_party_reference']) === sent.reference
    );
  const listed = await pollSettled(
    ctx,
    () => api.transactions({ wallet_id: main, limit: '20' }),
    (call) => findRow(call) !== undefined
  );
  const rowId = pickString(findRow(listed.value), ['id']);
  const single = rowId ? await api.transaction(rowId, main) : null;
  const singleRecord = single ? recordOf(single) : null;
  const singleFacts = analyseRecord(singleRecord, {
    sourceWalletId: main,
    destinationWalletId: goal,
    amountKobo: amount,
  });
  if (single)
    b.shape(
      'GET /transaction/:id (by list row)',
      single.httpStatus,
      single.data
    );
  b.finding(
    'single_transaction_names_both_wallets',
    UNKNOWN_QUESTIONS[7][1],
    singleRecord
      ? answerOf(
          singleFacts.namesSource === true &&
            singleFacts.namesDestination === true
        )
      : 'unknown'
  );
  b.finding(
    'single_transaction_shows_fee',
    'Does GET /transaction/:id show a fee field?',
    singleRecord ? answerOf(singleFacts.hasFee) : 'unknown'
  );

  // Balance deltas are only published once both wallets show the settled change.
  const balances = async () => ({
    main: await readWallet(ctx, main),
    goal: await readWallet(ctx, goal),
  });
  const measuring = sent.kind === 'sent' && watch.terminal === 'success';
  const settledBalances = measuring
    ? await pollSettled(ctx, balances, (now) => {
        const moved = (a: number | null, b2: number | null) =>
          a !== null && b2 !== null && a !== b2;
        return (
          moved(before.main.balance, now.main.balance) &&
          moved(before.goal.balance, now.goal.balance)
        );
      })
    : null;
  if (measuring && !settledBalances?.settled) {
    b.inconclusive(
      'balance readbacks did not show the settled transfer within the polling budget'
    );
  }
  if (measuring && !baseline.settled) {
    b.inconclusive(
      'the starting balances were still moving, so no balance delta is published'
    );
  }
  const after =
    settledBalances?.settled && baseline.settled ? settledBalances.value : null;
  // A fee field is "absent" only if every record we meant to read was read.
  const recordsShowFee = [
    tsqRecord ? facts.hasFee : null,
    singleRecord ? singleFacts.hasFee : null,
  ];
  state.walletTransfer = {
    kind: 'wallet',
    amountKobo: amount,
    terminal: watch.terminal,
    sourceDeltaKobo: after
      ? delta(before.main.balance, after.main.balance)
      : null,
    destinationDeltaKobo: after
      ? delta(before.goal.balance, after.goal.balance)
      : null,
    feeFromRecordKobo: singleFacts.feeKobo ?? facts.feeKobo,
    feeFieldPresent: recordsShowFee.includes(true)
      ? true
      : recordsShowFee.includes(null)
        ? null
        : false,
  };
  return b.build(ctx);
}
