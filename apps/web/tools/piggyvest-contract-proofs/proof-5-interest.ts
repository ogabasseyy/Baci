import { extractEdges, pickString, walletDataSchema } from './loose-schemas';
import { answerOf, ProofBuilder } from './proof-builder';
import type { ProofContext } from './proof-context';
import type { CallResult } from './provider-ops';
import type { ProofResult } from './types';

const TITLE = 'Interest visibility (development evidence only)';
const MAX_PAGES = 3;

export function countInterestRows(edges: unknown[]): number {
  return edges.filter((edge) =>
    /interest/i.test(pickString(edge, ['category']) ?? '')
  ).length;
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

interface Walk {
  pages: number;
  edgesPerPage: number[];
  advances: boolean | null;
  firstEdge: unknown;
  lastCall: CallResult | null;
}

/** Follows endCursor for up to MAX_PAGES pages. */
async function walk(
  fetchPage: (cursor?: string) => Promise<CallResult>
): Promise<Walk> {
  const result: Walk = {
    pages: 0,
    edgesPerPage: [],
    advances: null,
    firstEdge: undefined,
    lastCall: null,
  };
  let cursor: string | undefined;
  const seen = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const call = await fetchPage(cursor);
    result.lastCall = call;
    if (!call.ok) break;
    const list = extractEdges(call.data);
    result.pages += 1;
    result.edgesPerPage.push(list.edges.length);
    result.firstEdge ??= list.edges[0];
    const next = list.pageInfo?.endCursor ?? null;
    if (!list.pageInfo?.hasNextPage || next === null) break; // single page: not testable
    if (seen.has(next)) {
      result.advances = false;
      break;
    }
    seen.add(next);
    result.advances = true;
    cursor = next;
  }
  return result;
}

export async function runProof5(ctx: ProofContext): Promise<ProofResult> {
  const { api, state } = ctx;
  const b = new ProofBuilder('p5', TITLE);
  const target = state.mainWalletId ?? state.wallets[0]?.id ?? null;
  if (!target) return b.inconclusive('QA wallets unavailable').build(ctx);

  // Rates: the sandbox pays 0%, so absence is the expected result.
  let anyRate = false;
  for (const wallet of state.wallets) {
    const call = await api.wallet(wallet.id);
    const parsed = walletDataSchema.safeParse(call.data);
    const rate = parsed.success
      ? (parsed.data as Record<string, unknown>).current_interest_rate
      : null;
    if (typeof rate === 'number' && rate > 0) anyRate = true;
  }
  b.value('interest_rate_nonzero_on_any_wallet', anyRate);

  // Accrual read: default window.
  const def = await api.accrued(target, {});
  const defList = extractEdges(def.data);
  b.shape('GET accrued interest (page)', def.httpStatus, def.data);
  b.value('accrual_edges_default_window', defList.edges.length);
  b.value(
    'accrual_page_info_fields',
    defList.pageInfo ? Object.keys(defList.pageInfo).sort().join(',') : null
  );
  b.finding(
    'existing_accrual_schema_accepts_response',
    'Does the existing typed accrual schema accept the live response?',
    answerOf(def.typedAccepted)
  );

  // Accrual read: 3-month window, one record per page, following the cursor.
  const now = new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1)
  );
  const accrual = await walk((cursor) =>
    api.accrued(target, {
      start_date: isoDate(start),
      end_date: isoDate(now),
      limit: '1',
      ...(cursor ? { cursor } : {}),
    })
  );
  b.value('accrual_pages_walked', accrual.pages).value(
    'accrual_edges_per_page',
    accrual.edgesPerPage.join(',')
  );
  const observed = defList.edges.length > 0 || accrual.firstEdge !== undefined;
  b.finding(
    'accrual_records_observed',
    'Are any interest accrual records visible for the QA wallets?',
    answerOf(observed),
    observed
      ? undefined
      : 'No records exist at 0% sandbox rates; absence is the honest result.'
  );
  b.finding(
    'accrual_edge_shape_observed',
    'Was an accrual record shape observed?',
    answerOf(observed)
  );
  b.finding(
    'accrual_cursor_advances',
    'Does the accrual cursor advance across pages?',
    accrual.advances === null ? 'unknown' : answerOf(accrual.advances),
    accrual.advances === null
      ? 'only one page was available, so cursor behaviour could not be tested'
      : undefined
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
  b.value(
    'accrual_differential_edges',
    extractEdges(differential.data).edges.length
  );
  const over = await api.accrued(target, { limit: '101' });
  b.value('accrual_limit_101_http_status', over.httpStatus);

  // Transaction list: pagination and interest rows.
  const txWalk = await walk((cursor) =>
    api.transactions({
      wallet_id: target,
      limit: '1',
      ...(cursor ? { cursor } : {}),
    })
  );
  b.value('transaction_list_pages_walked', txWalk.pages);
  b.finding(
    'transaction_list_cursor_advances',
    'Does the transaction list cursor advance across pages?',
    txWalk.advances === null ? 'unknown' : answerOf(txWalk.advances)
  );
  const page = await api.transactions({ wallet_id: target, limit: '20' });
  const rows = extractEdges(page.data).edges;
  const interestRows = countInterestRows(rows);
  b.shape('GET /transaction (page)', page.httpStatus, page.data);
  b.value('transaction_list_rows_read', rows.length).value(
    'transaction_list_interest_rows',
    interestRows
  );
  b.finding(
    'transaction_list_has_interest_rows',
    'Does the transaction list contain interest rows?',
    page.ok ? answerOf(interestRows > 0) : 'unknown'
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
