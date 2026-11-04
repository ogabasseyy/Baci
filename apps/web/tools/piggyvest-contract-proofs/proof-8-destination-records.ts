import { AMOUNTS_KOBO } from './constants';
import { admitHouseWallet, houseRefusalReason } from './house-wallet';
import { pickString } from './loose-schemas';
import { awaitTerminal, readWallet } from './poll';
import { selectDestinationRow, sharedIdFields } from './proof-8-support';
import { answerOf, ProofBuilder } from './proof-builder';
import type { ProofContext } from './proof-context';
import type { CallResult } from './provider-ops';
import { foundAnswer, pollSettled, recordOf, usableList } from './read-rules';
import { analyseRecord } from './tsq-analysis';
import type { ProofResult } from './types';

const TITLE = 'Destination-side records for wallet-to-wallet transfers';

/**
 * For Collection -> main, main -> goal and goal -> main, what does the
 * DESTINATION wallet record? Its transaction-list row and single record are
 * compared with what the sender knows: our reference, the source wallet, and
 * the provider ids the source-side TSQ shows. The business sandbox wallet
 * stands in for Collection only once admitted (house-wallet.ts). Events are
 * not observable here (no receiver).
 */

interface Leg {
  name: 'collection_to_main' | 'main_to_goal' | 'goal_to_main';
  label: string;
  source: string | null;
  destination: string;
  /** Why the source is missing, when it is. */
  missing: string | null;
}

const QUESTIONS = (label: string): ReadonlyArray<readonly [string, string]> => [
  [
    'destination_row_listed',
    `${label}: does the destination wallet's transaction list show a row for the transfer?`,
  ],
  [
    'destination_row_carries_our_reference',
    `${label}: does the destination row carry our reference?`,
  ],
  [
    'destination_row_id_is_source_tsq_id',
    `${label}: is the destination row's id the provider transaction id the source-side TSQ shows?`,
  ],
  [
    'destination_resolves_source_tsq_id',
    `${label}: does GET /transaction/:id on the destination side resolve the source-side TSQ id?`,
  ],
  [
    'destination_record_names_source_wallet',
    `${label}: does the destination-side record name the source wallet?`,
  ],
];

function legUnknown(b: ProofBuilder, leg: Leg, reason: string): void {
  b.inconclusive(`${leg.name}: ${reason}`);
  for (const [id, question] of QUESTIONS(leg.label))
    b.finding(`${leg.name}_${id}`, question, 'unknown');
}

async function runLeg(ctx: ProofContext, b: ProofBuilder, leg: Leg) {
  const { api, qa, redactor } = ctx;
  const { source, destination } = leg;
  if (!source) return legUnknown(b, leg, leg.missing ?? 'no source wallet');
  const amount = AMOUNTS_KOBO.walletTransfer;
  const held = (await readWallet(ctx, source)).balance;
  if (held === null || held < amount)
    return legUnknown(
      b,
      leg,
      held === null
        ? 'the source wallet balance could not be read'
        : 'the source wallet holds less than the transfer amount'
    );
  const list = () => api.transactions({ wallet_id: destination, limit: '20' });
  const prior = usableList(await list());
  if (!prior)
    return legUnknown(b, leg, 'the destination list could not be read first');
  const excludeIds = new Set(
    prior.edges
      .map((edge) => pickString(edge, ['id']))
      .filter((id): id is string => id !== null)
  );

  const sent = await api.transferWallet(
    qa,
    source,
    destination,
    amount,
    `p8/${leg.name}`
  );
  redactor.register('R', sent.reference);
  if (sent.kind === 'resumed') {
    b.note(
      `The ${leg.name} slot was already used (${sent.priorOutcome}); it is never resent. Use --new-attempt to repeat it.`
    );
    return legUnknown(b, leg, 'transfer already executed in an earlier run');
  }
  const key = (id: string) => `${leg.name}_${id}`;
  b.value(key('transfer_http_status'), sent.call.httpStatus);
  if (!sent.call.ok) return legUnknown(b, leg, 'transfer was not accepted');
  const watch = await awaitTerminal(ctx, sent.reference, source);
  b.value(key('terminal'), watch.terminal);
  const tsq =
    watch.terminal === 'success' && watch.lastOk
      ? recordOf(watch.lastOk)
      : null;
  if (!tsq) return legUnknown(b, leg, 'the transfer did not settle');

  const expected = {
    reference: sent.reference,
    amountKobo: amount,
    excludeIds,
  };
  const pick = (call: CallResult) =>
    selectDestinationRow(usableList(call)?.edges ?? [], expected);
  const polled = await pollSettled(
    ctx,
    list,
    (call) => pick(call).row !== null
  );
  const match = pick(polled.value);
  const row = match.row;
  const [listed, carries, sameId, resolves, namesSource] = QUESTIONS(leg.label);
  b.value(key('destination_row_matched_by'), match.matchedBy);
  b.finding(
    key(listed[0]),
    listed[1],
    row ? 'yes' : 'unknown',
    row
      ? undefined
      : match.ambiguous
        ? 'more than one new credit row of the amount and none carrying our reference; no row was guessed'
        : `no new row matched within ${polled.polls} reads`
  );
  if (row) {
    b.shape(
      `GET /transaction (destination row, ${leg.name})`,
      polled.value.httpStatus,
      row
    );
    b.value(key('destination_row_type'), pickString(row, ['type'])).value(
      key('destination_row_category'),
      pickString(row, ['category'])
    );
  }
  b.finding(
    key(carries[0]),
    carries[1],
    row
      ? answerOf(pickString(row, ['third_party_reference']) === sent.reference)
      : 'unknown'
  );
  const tsqId = pickString(tsq, ['id']);
  const rowId = pickString(row, ['id']);
  if (!tsqId) {
    const why = 'the source-side TSQ record names no id';
    b.unobservable(key(sameId[0]), sameId[1], why);
    b.unobservable(key(resolves[0]), resolves[1], why);
  } else {
    b.finding(
      key(sameId[0]),
      sameId[1],
      rowId ? answerOf(rowId === tsqId) : 'unknown'
    );
    b.finding(
      key(resolves[0]),
      resolves[1],
      foundAnswer(await api.transaction(tsqId, destination))
    );
  }
  const single = rowId ? await api.transaction(rowId, destination) : null;
  const record = single ? recordOf(single) : null;
  if (single)
    b.shape(
      `GET /transaction/:id (destination, ${leg.name})`,
      single.httpStatus,
      single.data
    );
  const facts = analyseRecord(record, {
    sourceWalletId: source,
    destinationWalletId: destination,
    amountKobo: amount,
  });
  b.finding(
    key(namesSource[0]),
    namesSource[1],
    record ? answerOf(facts.namesSource) : 'unknown',
    facts.sourceKey ? `field: ${facts.sourceKey}` : undefined
  );
  const shared = sharedIdFields(record, tsq);
  b.value(
    key('ids_shared_with_source_tsq'),
    shared === null ? null : shared.join(',') || 'none'
  );
}

export async function runProof8(ctx: ProofContext): Promise<ProofResult> {
  const b = new ProofBuilder('p8', TITLE);
  const { state, mode } = ctx;
  b.unobservable(
    'destination_events',
    'Does a wallet-to-wallet transfer emit an inflow event at the destination wallet, and with which reference and ids?',
    'The harness has no webhook receiver. Confirm from the durable inbox; a destination inflow event would be a double-credit risk.'
  );
  const main = state.mainWalletId;
  const goal = state.goalWalletId;
  if (mode === 'live-readonly')
    return b.inconclusive('transfers need --live-sandbox-mutations').build(ctx);
  if (!main || !goal)
    return b.inconclusive('QA main/goal wallets unavailable').build(ctx);
  const house = await admitHouseWallet(ctx);
  const legs: Leg[] = [
    {
      name: 'collection_to_main',
      label: 'Collection to main',
      source: house.walletId,
      destination: main,
      missing: house.walletId ? null : houseRefusalReason(house),
    },
    {
      name: 'main_to_goal',
      label: 'Main to goal',
      source: main,
      destination: goal,
      missing: null,
    },
    {
      name: 'goal_to_main',
      label: 'Goal to main',
      source: goal,
      destination: main,
      missing: null,
    },
  ];
  for (const leg of legs) await runLeg(ctx, b, leg);
  b.note(
    'Collection is stood in for by the business sandbox wallet, admitted only once it reads back bound to no API customer.'
  );
  return b.build(ctx);
}
