import { extractEdges, pickString, walletDataSchema } from './loose-schemas';
import { stableWalk, type Walk } from './proof-5-walk';
import { answerOf, ProofBuilder } from './proof-builder';
import type { ProofContext } from './proof-context';
import { okData, usableList } from './read-rules';
import type { ProofResult } from './types';

const TITLE = 'Interest visibility (development evidence only)';

export function countInterestRows(edges: unknown[]): number {
  return edges.filter((edge) =>
    /interest/i.test(pickString(edge, ['category']) ?? '')
  ).length;
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

function cursorFinding(
  b: ProofBuilder,
  id: string,
  question: string,
  walked: Walk
): void {
  if (walked.advances !== null) {
    b.finding(id, question, answerOf(walked.advances));
  } else if (walked.singlePage) {
    b.unobservable(
      id,
      question,
      'only one page was available, so cursor behaviour could not be tested'
    );
  } else {
    b.finding(
      id,
      question,
      'unknown',
      'following the cursor gave no clean reading (a page failed, or the list changed while it was walked)'
    );
  }
}

export async function runProof5(ctx: ProofContext): Promise<ProofResult> {
  const { api, state } = ctx;
  const b = new ProofBuilder('p5', TITLE);
  const target = state.mainWalletId ?? state.wallets[0]?.id ?? null;
  if (!target) return b.inconclusive('QA wallets unavailable').build(ctx);

  // Rates: the sandbox pays 0%, so absence is the expected result.
  let anyRate = false;
  let ratesRead = 0;
  for (const wallet of state.wallets) {
    const call = await api.wallet(wallet.id);
    const parsed = walletDataSchema.safeParse(okData(call));
    const rate =
      call.ok && parsed.success
        ? (parsed.data as Record<string, unknown>).current_interest_rate
        : null;
    if (typeof rate === 'number') ratesRead += 1;
    if (typeof rate === 'number' && rate > 0) anyRate = true;
  }
  // `true` needs one positive rate; `false` needs a readable rate on EVERY wallet
  // the customer has, so both the main and the goal wallet must be known.
  const bothKnown = Boolean(state.mainWalletId && state.goalWalletId);
  b.value(
    'interest_rate_nonzero_on_any_wallet',
    anyRate
      ? true
      : bothKnown && ratesRead === state.wallets.length
        ? false
        : null
  );

  // Accrual read: default window.
  const def = await api.accrued(target, {});
  const defList = extractEdges(okData(def));
  const defUsable = def.ok && defList.container !== 'unknown';
  b.shape('GET accrued interest (page)', def.httpStatus, def.data);
  b.value(
    'accrual_edges_default_window',
    defUsable ? defList.edges.length : null
  );
  b.value(
    'accrual_page_info_fields',
    defUsable && defList.pageInfo
      ? Object.keys(defList.pageInfo).sort().join(',')
      : null
  );
  b.finding(
    'existing_accrual_schema_accepts_response',
    'Does the existing typed accrual schema accept the live response?',
    def.ok ? answerOf(def.typedAccepted) : 'unknown',
    def.ok ? undefined : 'the accrual read did not succeed'
  );

  // Accrual read: 3-month window, one record per page, following the cursor.
  const now = new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1)
  );
  const accrualWindow = { start_date: isoDate(start), end_date: isoDate(now) };
  const accrual = await stableWalk(
    ctx,
    (cursor) =>
      api.accrued(target, {
        ...accrualWindow,
        limit: '1',
        ...(cursor ? { cursor } : {}),
      }),
    () => api.accrued(target, { ...accrualWindow, limit: '100' })
  );
  b.value('accrual_pages_walked', accrual.pages).value(
    'accrual_edges_per_page',
    accrual.edgesPerPage.join(',')
  );
  const observed =
    (defUsable && defList.edges.length > 0) || accrual.firstEdge !== undefined;
  // Absence is only evidence if both accrual reads succeeded with a list we recognise.
  const absenceEstablished = defUsable && accrual.pages > 0;
  const accrualAnswer = observed
    ? 'yes'
    : absenceEstablished
      ? 'no'
      : 'unknown';
  b.finding(
    'accrual_records_observed',
    'Are any interest accrual records visible for the QA wallets?',
    accrualAnswer,
    accrualAnswer === 'no'
      ? 'No records exist at 0% sandbox rates; absence is the honest result.'
      : accrualAnswer === 'unknown'
        ? `the accrual read failed or returned an unrecognised list (HTTP ${def.httpStatus ?? 'none'}); absence is not established`
        : undefined
  );
  b.finding(
    'accrual_edge_shape_observed',
    'Was an accrual record shape observed?',
    accrualAnswer
  );
  if (accrualAnswer === 'unknown') {
    b.inconclusive('the accrual reads did not succeed with a recognised list');
  }
  cursorFinding(
    b,
    'accrual_cursor_advances',
    'Does the accrual cursor advance across pages?',
    accrual
  );
  if (observed)
    b.shape(
      'GET accrued interest (edge)',
      null,
      defList.edges[0] ?? accrual.firstEdge
    );

  const differential = await api.accrued(target, {
    interest_type: 'differential',
  });
  const differentialList = usableList(differential);
  b.value(
    'accrual_differential_edges',
    differentialList ? differentialList.edges.length : null
  );
  const over = await api.accrued(target, { limit: '101' });
  b.value('accrual_limit_101_http_status', over.httpStatus);

  // Transaction list: pagination and interest rows.
  const txWalk = await stableWalk(
    ctx,
    (cursor) =>
      api.transactions({
        wallet_id: target,
        limit: '1',
        ...(cursor ? { cursor } : {}),
      }),
    () => api.transactions({ wallet_id: target, limit: '100' })
  );
  b.value('transaction_list_pages_walked', txWalk.pages);
  cursorFinding(
    b,
    'transaction_list_cursor_advances',
    'Does the transaction list cursor advance across pages?',
    txWalk
  );
  const pageList = txWalk.settledList;
  const rows = pageList?.edges ?? [];
  const interestRows = countInterestRows(rows);
  if (txWalk.settledCall) {
    b.shape(
      'GET /transaction (page)',
      txWalk.settledCall.httpStatus,
      txWalk.settledCall.data
    );
  }
  b.value('transaction_list_rows_read', pageList ? rows.length : null).value(
    'transaction_list_interest_rows',
    pageList ? interestRows : null
  );
  b.finding(
    'transaction_list_has_interest_rows',
    'Does the transaction list contain interest rows?',
    pageList ? answerOf(interestRows > 0) : 'unknown',
    pageList
      ? undefined
      : 'the transaction list never settled (or could not be read) within the polling budget'
  );
  b.value(
    'transaction_list_limit_101_http_status',
    (await api.transactions({ wallet_id: target, limit: '101' })).httpStatus
  );

  b.note(
    'Development evidence only. A real monthly payout observed through the API is a later release check (1 Dec at the earliest); the API-recovery guarantee stays conditional until then.'
  );
  return b.build(ctx);
}
