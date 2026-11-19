import { extractEdges, pickString } from './loose-schemas';
import type { ProofContext } from './proof-context';
import type { CallResult } from './provider-ops';
import { okData, usableList } from './read-rules';

const MAX_PAGES = 3;

export interface Walk {
  pages: number;
  edgesPerPage: number[];
  advances: boolean | null;
  /** The first page was read and there was no next page: nothing to follow. */
  singlePage: boolean;
  firstEdge: unknown;
  lastCall: CallResult | null;
}

/** A row's identity: its id when it has one, else its whole content. */
const rowKey = (edge: unknown): string =>
  pickString(edge, ['id']) ?? JSON.stringify(edge);

/**
 * Follows endCursor for up to MAX_PAGES pages. `advances` is true only if every
 * FOLLOW-UP page was read successfully, with a recognised list, and brought at
 * least one row not seen on an earlier page. Progress is judged by the ROWS,
 * never the cursor token: a pager that rotates its token over the same rows has
 * not advanced. It is false if a follow-up page repeats rows already seen (or
 * the cursor cycles); null if no follow-up page was read (single page, or
 * following the cursor failed).
 */
export async function walk(
  fetchPage: (cursor?: string) => Promise<CallResult>
): Promise<Walk> {
  const result: Walk = {
    pages: 0,
    edgesPerPage: [],
    advances: null,
    singlePage: false,
    firstEdge: undefined,
    lastCall: null,
  };
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  const seenRows = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const call = await fetchPage(cursor);
    result.lastCall = call;
    const list = extractEdges(okData(call));
    // A page counts only if the request succeeded AND its list was recognised.
    if (!call.ok || list.container === 'unknown') break;
    result.pages += 1;
    result.edgesPerPage.push(list.edges.length);
    result.firstEdge ??= list.edges[0];
    const keys = list.edges.map(rowKey);
    if (page > 0) {
      const progressed = keys.some((key) => !seenRows.has(key));
      result.advances = (result.advances ?? true) && progressed;
    }
    for (const key of keys) seenRows.add(key);
    const next = list.pageInfo?.endCursor ?? null;
    if (!list.pageInfo?.hasNextPage || next === null) {
      result.singlePage = page === 0; // no follow-up page to test
      break;
    }
    if (seenCursors.has(next)) {
      result.advances = false;
      break;
    }
    seenCursors.add(next);
    cursor = next;
  }
  return result;
}

export interface SettledWalk extends Walk {
  /**
   * The full list as it stood once it had stopped changing, and still stood
   * after the walk; null if it never settled or changed (or failed) after.
   */
  settledList: ReturnType<typeof extractEdges> | null;
  settledCall: CallResult | null;
}

/**
 * The list must hold still while it is walked. A row that becomes visible
 * mid-walk shifts every later page, so a repeated page would look like a stuck
 * cursor (and a rotating cursor could look like progress). Rows can lag for as
 * long as the polling budget, so the full list is read for the WHOLE budget and
 * counts as settled only if nothing changed in the final round; the walk then
 * runs, and the list is read once more: if it changed, nothing is concluded.
 * The settled list is also the one absence claims ("no interest rows") use.
 */
export async function stableWalk(
  ctx: ProofContext,
  fetchPage: (cursor?: string) => Promise<CallResult>,
  snapshot: () => Promise<CallResult>
): Promise<SettledWalk> {
  const signatureOf = (call: CallResult): string | null => {
    const list = usableList(call);
    return list ? JSON.stringify(list.edges.map(rowKey)) : null;
  };
  let call = await snapshot();
  let last = signatureOf(call);
  let movedInFinalRound = true;
  for (let poll = 0; poll < ctx.maxPolls; poll += 1) {
    await ctx.sleep(ctx.pollIntervalMs);
    call = await snapshot();
    const next = signatureOf(call);
    movedInFinalRound = next !== last;
    last = next;
  }
  const settled = ctx.maxPolls > 0 && !movedInFinalRound && last !== null;
  const walked = await walk(fetchPage);
  const after = signatureOf(await snapshot());
  const clean = settled && after === last;
  if (!clean) {
    walked.advances = null;
    walked.singlePage = false; // not a clean "nothing to follow": the list was unstable
  }
  // The snapshot is evidence only if it still held when the walk was over: a
  // row that appeared (or a read that failed) after the walk invalidates it, so
  // no absence or count claim may rest on it.
  return {
    ...walked,
    settledList: clean ? usableList(call) : null,
    settledCall: clean ? call : null,
  };
}
