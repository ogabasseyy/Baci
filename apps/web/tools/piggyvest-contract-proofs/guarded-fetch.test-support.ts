import { vi } from 'vitest';
import type { RunMode } from './constants';
import { createGuardedFetch, type GuardedFetchOptions } from './guarded-fetch';
import { MutationGate, type MutationIntent } from './mutation-gate';
import { createMemoryJournal } from './mutation-journal';
import { ResponseCapture } from './response-capture';
import { HarnessRefusal } from './safety-guards';

export const ORIGIN = 'https://staging.piggyvest.business';
export const KEY = 'test_key_AbC123xyz';
export const AUTH = { Authorization: `Bearer ${KEY}` };

export function build(
  mode: RunMode,
  respond?: (url: string) => Response,
  pacing: Partial<Pick<GuardedFetchOptions, 'minGapMs' | 'now' | 'sleep'>> = {}
) {
  const baseFetch = vi.fn(
    async (input: RequestInfo | URL, _init?: RequestInit) =>
      respond
        ? respond(String(input))
        : new Response(
            JSON.stringify({ status: true, message: 'ok', data: { a: 1 } }),
            {
              status: 200,
            }
          )
  );
  const journal = createMemoryJournal();
  const gate = new MutationGate({
    mode,
    journal,
    runId: 'run1',
    attempt: 1,
    isWalletAuthorized: (id) => id.startsWith('qa-wallet-'),
  });
  const capture = new ResponseCapture();
  const guarded = createGuardedFetch({
    mode,
    origin: ORIGIN,
    baseFetch: baseFetch as unknown as typeof fetch,
    gate,
    capture,
    ...pacing,
  });
  return { guarded, baseFetch, gate, capture, journal };
}

export async function refusal(
  run: () => Promise<unknown>
): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return error instanceof HarnessRefusal ? error.code : 'NOT_A_REFUSAL';
  }
}

export const walletTransfer: MutationIntent = {
  slot: 'p2/w2w',
  op: 'wallet_transfer',
  path: '/api/v1/transfer/wallet',
  qaKey: 'qa-customer-1',
  bodyMatch: {
    source: 'qa-wallet-a',
    destination: 'qa-wallet-b',
    amount: 100000,
  },
  walletIds: ['qa-wallet-a', 'qa-wallet-b'],
  amountKobo: 100000,
  referenceField: 'reference',
};
