import { randomBytes } from 'node:crypto';
import { AMOUNTS_KOBO } from './constants';
import { extractEdges, pickString } from './loose-schemas';
import { awaitTerminal, delta, readWallet, statusOf } from './poll';
import { answerOf, ProofBuilder } from './proof-builder';
import type { ProofContext } from './proof-context';
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
    answerOf(unknown.httpStatus === null ? null : unknown.httpStatus === 404)
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
  const before = {
    main: await readWallet(ctx, main),
    goal: await readWallet(ctx, goal),
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
  const watch = await awaitTerminal(ctx, sent.reference, main);
  const sequence = [immediateStatus, ...watch.statuses].filter(
    (status, i, all) => all.indexOf(status) === i
  );
  b.value('status_sequence', statusVocabulary(sequence))
    .value('terminal', watch.terminal)
    .value('polls_to_terminal', watch.polls);

  const final = watch.lastOk ?? (immediate.ok ? immediate : null);
  const facts = analyseRecord(final?.data, {
    sourceWalletId: main,
    destinationWalletId: goal,
    amountKobo: amount,
  });
  if (final) {
    b.shape('GET TSQ (terminal)', final.httpStatus, final.data);
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
      answerOf(final.typedAccepted)
    );
  } else {
    b.inconclusive('no successful TSQ response was observed');
    for (const [id, question] of UNKNOWN_QUESTIONS.slice(0, 7))
      b.finding(id, question, 'unknown');
  }
  b.finding(
    'tsq_found_with_source_wallet_filter',
    'Is the reference found when narrowed by the source wallet?',
    answerOf((await api.verify(sent.reference, main)).ok)
  );
  b.finding(
    'tsq_found_with_destination_wallet_filter',
    'Is the reference found when narrowed by the destination wallet?',
    answerOf((await api.verify(sent.reference, goal)).ok)
  );

  // C. Fallback evidence: the single-transaction record, found via the list.
  const list = await api.transactions({ wallet_id: main, limit: '20' });
  const row = extractEdges(list.data).edges.find(
    (edge) => pickString(edge, ['third_party_reference']) === sent.reference
  );
  const rowId = pickString(row, ['id']);
  const single = rowId ? await api.transaction(rowId, main) : null;
  const singleFacts = analyseRecord(single?.data, {
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
    single?.ok
      ? answerOf(
          singleFacts.namesSource === true &&
            singleFacts.namesDestination === true
        )
      : 'unknown'
  );
  b.finding(
    'single_transaction_shows_fee',
    'Does GET /transaction/:id show a fee field?',
    single?.ok ? answerOf(singleFacts.hasFee) : 'unknown'
  );

  const after = {
    main: await readWallet(ctx, main),
    goal: await readWallet(ctx, goal),
  };
  state.walletTransfer = {
    kind: 'wallet',
    amountKobo: amount,
    terminal: watch.terminal,
    sourceDeltaKobo:
      sent.kind === 'sent'
        ? delta(before.main.balance, after.main.balance)
        : null,
    destinationDeltaKobo:
      sent.kind === 'sent'
        ? delta(before.goal.balance, after.goal.balance)
        : null,
    feeFromRecordKobo: singleFacts.feeKobo ?? facts.feeKobo,
  };
  return b.build(ctx);
}
