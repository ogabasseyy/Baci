import { vi } from 'vitest';
import { type RunMode, SANDBOX_ORIGIN } from './constants';
import { createGuardedFetch } from './guarded-fetch';
import { createMockProvider, MOCK_API_KEY } from './mock-provider';
import type { MockOptions } from './mock-sandbox';
import { MutationGate } from './mutation-gate';
import { createMemoryJournal, type Journal } from './mutation-journal';
import { emptyScenarioState, type ProofContext } from './proof-context';
import { ProviderApi, qaIdentityFor } from './provider-ops';
import { Redactor } from './redactor';
import { ResponseCapture } from './response-capture';

export interface HarnessOptions {
  mode?: RunMode;
  mock?: Partial<MockOptions>;
  journal?: Journal;
  attempt?: number;
  /** Polling budget handed to the proofs (default 6). */
  maxPolls?: number;
  runId?: string;
  qaKey?: string;
  baseUrl?: string;
  bank?: { code: string; account: string } | null;
  /** Undefined = the mock's business wallet; null = none configured. */
  businessWalletId?: string | null;
}

/**
 * Full stack for tests: mock provider -> guarded fetch (installed as the
 * global fetch, exactly like a real run) -> existing typed client -> ops.
 */
export function makeHarness(options: HarnessOptions = {}) {
  const mode = options.mode ?? 'live-sandbox-mutations';
  const mock = createMockProvider(options.mock);
  const capture = new ResponseCapture();
  const journal = options.journal ?? createMemoryJournal();
  const state = emptyScenarioState();
  const gate = new MutationGate({
    mode,
    journal,
    runId: options.runId ?? 'run1',
    attempt: options.attempt ?? 1,
    isWalletAuthorized: (id) => state.authorized.has(id),
  });
  const guarded = createGuardedFetch({
    mode,
    origin: SANDBOX_ORIGIN,
    baseFetch: mock.fetch,
    gate,
    capture,
  });
  vi.stubGlobal('fetch', guarded);
  const api = new ProviderApi(
    { baseUrl: options.baseUrl ?? SANDBOX_ORIGIN, token: MOCK_API_KEY },
    capture,
    gate
  );
  const redactor = new Redactor();
  const ctx: ProofContext = {
    mode,
    api,
    redactor,
    qa: qaIdentityFor(options.qaKey ?? 'qa-customer-0001'),
    state,
    sleep: async () => undefined,
    pollIntervalMs: 0,
    maxPolls: options.maxPolls ?? 6,
    attempt: options.attempt ?? 1,
    bank:
      options.bank === undefined
        ? { code: '058', account: '0123456789' }
        : options.bank,
    businessWalletId:
      options.businessWalletId === undefined
        ? mock.sandbox.businessWalletId
        : options.businessWalletId,
  };
  return {
    ctx,
    api,
    mock,
    journal,
    gate,
    capture,
    state,
    redactor,
    dispose: () => vi.unstubAllGlobals(),
  };
}
