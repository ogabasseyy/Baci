import 'server-only';
import { piggyvestTransactionStatusSchemas } from '@/schemas/piggyvest-transaction-status';

type VerifyQuery = (selection: {
  reference: string;
  walletId: string;
}) => Promise<unknown>;

export interface SavingsVerifyRetryOptions {
  // Wait before each extra try; its length is the number of extra tries.
  delaysMs?: readonly number[];
  // No extra try starts once this much time has passed since the first try
  // began (slow provider answers use the budget up instead of stacking).
  budgetMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

// Production incident 2026-11-17: PiggyVest's verify record lagged its own
// outflow webhook by a few seconds, so the first re-query read non-terminal,
// the webhook answered 503 and the customer's savings stayed pending until
// the ~2 minute redelivery. Three short extra tries cover that lag. Worst
// case (each try near its 10 s request timeout) stays near 20 s: the budget
// stops new tries after 8 s. The route sets no maxDuration, so the platform
// default applies, far above this.
export const SAVINGS_VERIFY_RETRY_DELAYS_MS = [1500, 2000, 2000] as const;
export const SAVINGS_VERIFY_RETRY_BUDGET_MS = 8000;

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// Worth re-asking = a well-formed TSQ record not yet 'successful' or
// 'failed'. A terminal record (matching or not) will not change, and a
// malformed body is not lag: both pass straight through to the proof.
function isNonTerminalRecord(response: unknown): boolean {
  const parsed =
    piggyvestTransactionStatusSchemas.walletTransferResponse.safeParse(
      response
    );
  return (
    parsed.success &&
    parsed.data.data.status !== 'successful' &&
    parsed.data.data.status !== 'failed'
  );
}

// A TSQ 404 is "not indexed yet" as often as "never sent"; it is the lag
// signal too. Timeouts and other errors are not retried here (they already
// used their own budget and the redelivery still covers them).
function isNotIndexedYet(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === 'PROVIDER_HTTP_ERROR' &&
    (error as Error & { httpStatus?: unknown }).httpStatus === 404
  );
}

// Wraps the shared verify query for the webhook outflow path: re-asks only
// while the provider has not reached a terminal record. The final answer
// (record or error) is passed through unchanged, so the proof, settle and
// release behave exactly as for a single query.
export function withSavingsVerifyRetry(
  query: VerifyQuery,
  options: SavingsVerifyRetryOptions = {}
): VerifyQuery {
  const delays = options.delaysMs ?? SAVINGS_VERIFY_RETRY_DELAYS_MS;
  const budgetMs = options.budgetMs ?? SAVINGS_VERIFY_RETRY_BUDGET_MS;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  return async (selection) => {
    const startedAt = now();
    for (let attempt = 0; ; attempt += 1) {
      const delay = delays[attempt];
      const canRetry = () =>
        delay !== undefined && now() - startedAt + delay <= budgetMs;
      let response: unknown;
      try {
        response = await query(selection);
      } catch (error) {
        if (!isNotIndexedYet(error) || !canRetry()) throw error;
        await sleep(delay as number);
        continue;
      }
      if (!isNonTerminalRecord(response) || !canRetry()) return response;
      await sleep(delay as number);
    }
  };
}
