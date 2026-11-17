import 'server-only';
import { piggyvestTransactionStatusSchemas } from '@/schemas/piggyvest-transaction-status';
import { SAVINGS_VERIFY_RETRY_POLICY } from './primary-wallet-savings-verify-retry-policy';

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

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// Worth re-asking = a well-formed TSQ record still 'pending': the only state
// the proof can later settle or release. 'successful'/'failed' will not
// change, the proof never settles 'success', and a malformed body is not
// lag: all of those pass straight through to the proof.
function isPendingRecord(response: unknown): boolean {
  const parsed =
    piggyvestTransactionStatusSchemas.walletTransferResponse.safeParse(
      response
    );
  return parsed.success && parsed.data.data.status === 'pending';
}

// A TSQ 404 is "not indexed yet" as often as "never sent"; it is the lag
// signal too. Timeouts and other errors are not retried here (they already
// used their own budget and the redelivery still covers them).
function isNotIndexedYet(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === 'PROVIDER_HTTP_ERROR' &&
    'httpStatus' in error &&
    error.httpStatus === 404
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
  const delays = options.delaysMs ?? SAVINGS_VERIFY_RETRY_POLICY.delaysMs;
  const budgetMs = options.budgetMs ?? SAVINGS_VERIFY_RETRY_POLICY.budgetMs;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  return async (selection) => {
    const startedAt = now();
    for (let attempt = 0; ; attempt += 1) {
      const delay = delays[attempt];
      // The wait before another try, or undefined when no try may start.
      const nextDelay = () =>
        delay !== undefined && now() - startedAt + delay <= budgetMs
          ? delay
          : undefined;
      // A late timer (stalled event loop) must not start a try past the
      // budget: re-check the clock after every wait.
      const withinBudget = () => now() - startedAt <= budgetMs;
      let response: unknown;
      try {
        response = await query(selection);
      } catch (error) {
        const wait = isNotIndexedYet(error) ? nextDelay() : undefined;
        if (wait === undefined) throw error;
        await sleep(wait);
        if (!withinBudget()) throw error;
        continue;
      }
      const wait = isPendingRecord(response) ? nextDelay() : undefined;
      if (wait === undefined) return response;
      await sleep(wait);
      if (!withinBudget()) return response;
    }
  };
}
