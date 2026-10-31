import { extractEdges, pickString, walletDataSchema } from './loose-schemas';
import { answerOf, ProofBuilder } from './proof-builder';
import type { ProofContext } from './proof-context';
import type { CallResult } from './provider-ops';
import { okData, usableList } from './read-rules';
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

/** Identifies a page by its rows and its cursor, to tell whether a follow-up page differs. */
const pageSignature = (list: ReturnType<typeof extractEdges>) =>
  `${JSON.stringify(list.edges)}|${list.pageInfo?.endCursor ?? ''}`;

/**
 * Follows endCursor for up to MAX_PAGES pages. `advances` is true only after a
 * FOLLOW-UP page was read successfully, with a recognised list, and differs
 * from the page before it; false if that page repeats the previous one; null if
 * no follow-up page was read (single page, or following the cursor failed).
 */
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
  let previous: string | null = null;
  const seen = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const call = await fetchPage(cursor);
    result.lastCall = call;
    const list = extractEdges(okData(call));
    // A page counts only if the request succeeded AND its list was recognised.
    if (!call.ok || list.container === 'unknown') break;
    result.pages += 1;
    result.edgesPerPage.push(list.edges.length);
    result.firstEdge ??= list.edges[0];
    const signature = pageSignature(list);
    if (previous !== null) result.advances = signature !== previous;
    previous = signature;
    const next = list.pageInfo?.endCursor ?? null;
    if (!list.pageInfo?.hasNextPage || next === null) break; // no follow-up page to test
    if (seen.has(next)) {
      result.advances = false;
      break;
    }
    seen.add(next);
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
  b.value(
    'interest_rate_nonzero_on_any_wallet',
    ratesRead > 0 ? anyRate : null
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
  const differentialList = usableList(differential);
  b.value(
    'accrual_differential_edges',
    differentialList ? differentialList.edges.length : null
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
  const pageList = extractEdges(okData(page));
  const pageUsable = page.ok && pageList.container !== 'unknown';
  const rows = pageList.edges;
  const interestRows = countInterestRows(rows);
  b.shape('GET /transaction (page)', page.httpStatus, page.data);
  b.value('transaction_list_rows_read', pageUsable ? rows.length : null).value(
    'transaction_list_interest_rows',
    pageUsable ? interestRows : null
  );
  b.finding(
    'transaction_list_has_interest_rows',
    'Does the transaction list contain interest rows?',
    pageUsable ? answerOf(interestRows > 0) : 'unknown'
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
