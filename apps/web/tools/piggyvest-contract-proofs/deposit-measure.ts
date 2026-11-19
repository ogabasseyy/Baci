import { pickString } from './loose-schemas';
import type { JournalOutcome } from './mutation-journal';
import { delta, readingOf, settledWallets } from './poll';
import { selectDepositRow } from './proof-3-goal-deposit';
import type { ProofContext } from './proof-context';
import type { CallResult } from './provider-ops';
import { pollSettled, recordOf, usableList } from './read-rules';
import { creditComplete } from './settle-rule';
import { analyseRecord, type RecordFacts } from './tsq-analysis';

/**
 * One journaled test-funding deposit into one wallet, measured the way
 * proof 3 measures the goal deposit: a settled baseline, the deposit, a
 * settled result, then THIS deposit's credit row (rows listed before it are
 * excluded, and the row's amount must equal the gross or the measured
 * credit) and its single-record read. Used for the house wallet (proof 3)
 * and the main wallet (proof 9).
 */

interface Funding {
  fundingHttpStatus: number | null;
  fundingOutcome: JournalOutcome;
}

export type DepositMeasurement =
  | { kind: 'resumed'; priorOutcome: string }
  | ({ kind: 'unsettled'; reason: string } & Funding)
  | ({
      kind: 'measured';
      creditedKobo: number;
      /**
       * The shared settle rule holds: the settled credit is the full gross
       * minus the fee this deposit's record shows. A partial tranche, or a
       * net credit whose fee record is not visible, is measured but not
       * complete, and must never be marked settled in a ledger.
       */
      complete: boolean;
      /** This deposit's list row, or null with the reason in rowDetail. */
      row: unknown;
      rowDetail: string | null;
      listHttpStatus: number | null;
      single: CallResult | null;
      record: Record<string, unknown> | null;
      facts: RecordFacts;
    } & Funding);

export async function measureDeposit(
  ctx: ProofContext,
  walletId: string,
  grossKobo: number,
  slot: string
): Promise<DepositMeasurement> {
  const { api, qa } = ctx;
  const list = () => api.transactions({ wallet_id: walletId, limit: '20' });
  const baseline = await settledWallets(ctx, [walletId]);
  const prior = usableList(await list());
  const priorIds = new Set(
    (prior?.edges ?? [])
      .map((edge) => pickString(edge, ['id']))
      .filter((id): id is string => id !== null)
  );
  const funded = await api.fundWallet(qa, walletId, grossKobo, slot);
  if (funded.kind === 'resumed')
    return { kind: 'resumed', priorOutcome: funded.priorOutcome };
  const funding: Funding = {
    fundingHttpStatus: funded.call.httpStatus,
    fundingOutcome: funded.outcome,
  };

  const after = await settledWallets(ctx, [walletId]);
  const credited = delta(
    readingOf(baseline, walletId).balance,
    readingOf(after, walletId).balance
  );
  if (!baseline.settled || !after.settled || credited === null || credited <= 0)
    return {
      kind: 'unsettled',
      ...funding,
      reason:
        baseline.settled && after.settled
          ? 'the deposit did not settle within the polling window'
          : 'the balances were still moving, so no clean credit could be measured',
    };

  const credits = (call: CallResult) =>
    (usableList(call)?.edges ?? []).filter(
      (edge) => pickString(edge, ['type']) === 'credit'
    );
  const pick = (call: CallResult) =>
    prior
      ? selectDepositRow(credits(call), grossKobo, credited, priorIds)
      : undefined;
  const polled = await pollSettled(
    ctx,
    list,
    (call) => pick(call) !== undefined
  );
  const row = pick(polled.value) ?? null;
  const rowId = pickString(row, ['id']);
  const single = rowId ? await api.transaction(rowId, walletId) : null;
  const record = single ? recordOf(single) : null;
  const facts = analyseRecord(record, {
    sourceWalletId: null,
    destinationWalletId: walletId,
    amountKobo: grossKobo,
  });
  return {
    kind: 'measured',
    ...funding,
    creditedKobo: credited,
    complete: creditComplete(credited, grossKobo, facts.feeKobo),
    row,
    rowDetail: row
      ? null
      : !prior
        ? "the list of earlier rows could not be read, so this deposit's row cannot be told apart from older ones"
        : usableList(polled.value)
          ? `no credit row matched the gross or the measured credit within ${polled.polls} reads; no row was guessed`
          : 'the transaction list could not be read',
    listHttpStatus: polled.value.httpStatus,
    single,
    record,
    facts,
  };
}
