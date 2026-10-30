import { type ExtractedList, extractEdges } from './loose-schemas';
import type { ProofContext } from './proof-context';
import type { CallResult } from './provider-ops';
import type { Answer } from './types';

/**
 * The two rules every proof follows, in one place.
 *
 * (A) A finding that concludes absence, "no change" or `no` must rest on reads
 *     that SUCCEEDED and returned a RECOGNISED container or field. A failed
 *     request, a gateway error or an unrecognised shape is `unknown`, never
 *     "nothing there".
 * (B) A measurement taken after a mutation (balances, counters, list rows,
 *     accruals, payout fields) is polled within the configured settle budget
 *     and reported `unknown` if it never settles, never published as-is.
 */

/** Network errors, 5xx, rate limits and timeouts say nothing about the data. */
export function isTransientFailure(status: number | null): boolean {
  return status === null || status >= 500 || status === 429 || status === 408;
}

/** The data as a plain object, only if the request succeeded. */
export function recordOf(call: CallResult): Record<string, unknown> | null {
  const data = call.data;
  return call.ok &&
    data !== null &&
    typeof data === 'object' &&
    !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : null;
}

/** A list, only if the request succeeded AND the container was recognised. */
export function usableList(call: CallResult): ExtractedList | null {
  if (!call.ok) return null;
  const list = extractEdges(call.data);
  return list.container === 'unknown' ? null : list;
}

/**
 * Did a lookup find its target? `no` needs a definite, non-transient decline
 * from the provider; a gateway error or dropped connection is `unknown`.
 */
export function foundAnswer(call: CallResult): Answer {
  if (call.ok) return 'yes';
  if (
    call.declined &&
    call.httpStatus !== null &&
    !isTransientFailure(call.httpStatus)
  ) {
    return 'no';
  }
  return 'unknown';
}

export interface Settled<T> {
  value: T;
  settled: boolean;
  polls: number;
}

/**
 * Reads until `isSettled`, spending at most the configured polling budget
 * (`maxPolls` retries). Returns the last reading and whether it settled; the
 * caller must treat an unsettled reading as `unknown`.
 */
export async function pollSettled<T>(
  budget: Pick<ProofContext, 'maxPolls' | 'pollIntervalMs' | 'sleep'>,
  read: () => Promise<T>,
  isSettled: (value: T) => boolean
): Promise<Settled<T>> {
  let value = await read();
  let polls = 1;
  while (!isSettled(value) && polls <= budget.maxPolls) {
    await budget.sleep(budget.pollIntervalMs);
    value = await read();
    polls += 1;
  }
  return { value, settled: isSettled(value), polls };
}
