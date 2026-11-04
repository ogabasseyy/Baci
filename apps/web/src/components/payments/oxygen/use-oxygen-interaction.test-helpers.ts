import { act } from '@testing-library/react';
import { afterEach, beforeEach, type Mock, vi } from 'vitest';
import type {
  OxygenHandoffPayload,
  OxygenInteractionLookup,
  OxygenInteractionSubmit,
  OxygenLookupResult,
  OxygenMarkerStorage,
  OxygenSubmitResult,
} from '@/lib/payments/oxygen/interaction';
import type { UseOxygenInteractionOptions } from './use-oxygen-interaction';

export const ORDER_A = 'order-aaaa-0000-4000-8000-aaaaaaaaaaaa';
export const ORDER_B = 'order-bbbb-0000-4000-8000-bbbbbbbbbbbb';
export const NOW = 1_760_000_000_000;

export const FORBIDDEN_PHRASES = [
  'approved',
  'approval',
  'eligible',
  'eligibility',
  'qualify',
  'qualified',
  'pre-approved',
  'approved for',
];

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export class FakeMarkerStorage implements OxygenMarkerStorage {
  private entries = new Map<string, string>();

  get length(): number {
    return this.entries.size;
  }

  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, value);
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }

  keys(): string[] {
    return [...this.entries.keys()];
  }
}

export function lookupOk(
  available: boolean,
  reason?: string
): OxygenLookupResult {
  return reason === undefined
    ? { ok: true, available }
    : { ok: true, available, reason };
}

export function lookupErr(status: number, code?: string): OxygenLookupResult {
  return { ok: false, status, code };
}

export function submitErr(status: number, code?: string): OxygenSubmitResult {
  return { ok: false, status, code };
}

interface Harness {
  lookups: Deferred<OxygenLookupResult>[];
  submits: Deferred<OxygenSubmitResult>[];
  lookup: Mock<OxygenInteractionLookup>;
  submit: Mock<OxygenInteractionSubmit>;
  storage: FakeMarkerStorage;
  nonces: string[];
  generateNonce: Mock<() => string>;
  handoffs: OxygenHandoffPayload[];
  onSecureFormRequest: Mock<(payload: OxygenHandoffPayload) => void>;
  now: () => number;
}

export function createHarness(): Harness {
  const lookups: Deferred<OxygenLookupResult>[] = [];
  const submits: Deferred<OxygenSubmitResult>[] = [];
  const nonces: string[] = [];
  const handoffs: OxygenHandoffPayload[] = [];
  let nonceCounter = 0;
  return {
    lookups,
    submits,
    lookup: vi.fn<OxygenInteractionLookup>(() => {
      const pending = deferred<OxygenLookupResult>();
      lookups.push(pending);
      return pending.promise;
    }),
    submit: vi.fn<OxygenInteractionSubmit>(() => {
      const pending = deferred<OxygenSubmitResult>();
      submits.push(pending);
      return pending.promise;
    }),
    storage: new FakeMarkerStorage(),
    nonces,
    generateNonce: vi.fn<() => string>(() => {
      nonceCounter += 1;
      const nonce = `nonce-${nonceCounter}`;
      nonces.push(nonce);
      return nonce;
    }),
    handoffs,
    onSecureFormRequest: vi.fn<(payload: OxygenHandoffPayload) => void>(
      (payload) => {
        handoffs.push(payload);
      }
    ),
    now: () => NOW,
  };
}

export function propsFor(
  harness: Harness,
  overrides: Partial<UseOxygenInteractionOptions> = {}
): UseOxygenInteractionOptions {
  return {
    orderId: ORDER_A,
    session: { status: 'authenticated' },
    lookup: harness.lookup,
    submit: harness.submit,
    storage: harness.storage,
    now: harness.now,
    generateNonce: harness.generateNonce,
    onSecureFormRequest: harness.onSecureFormRequest,
    ...overrides,
  };
}

export async function resolveLookup(
  harness: Harness,
  index: number,
  result: OxygenLookupResult
): Promise<void> {
  // biome-ignore lint/suspicious/useAwait: React act flushes promise-driven state updates.
  await act(async () => {
    harness.lookups[index]?.resolve(result);
  });
}

export async function resolveSubmit(
  harness: Harness,
  index: number,
  result: OxygenSubmitResult
): Promise<void> {
  // biome-ignore lint/suspicious/useAwait: React act flushes promise-driven state updates.
  await act(async () => {
    harness.submits[index]?.resolve(result);
  });
}

export function setupInteractionTests() {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {
      // Suppress expected host errors in individual tests.
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
}
