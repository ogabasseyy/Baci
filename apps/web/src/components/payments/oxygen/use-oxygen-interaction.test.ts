import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, renderHook } from '@testing-library/react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';
import {
  OXYGEN_HANDOFF_MARKER_TTL_MS,
  type OxygenHandoffPayload,
  type OxygenInteractionLookup,
  type OxygenInteractionSubmit,
  type OxygenLookupResult,
  type OxygenMarkerStorage,
  type OxygenSubmitResult,
  oxygenHandoffMarkerKey,
  readOxygenHandoffMarker,
  writeOxygenHandoffMarker,
} from '@/lib/payments/oxygen/interaction';
import {
  type UseOxygenInteractionOptions,
  useOxygenInteraction,
} from './use-oxygen-interaction';

const ORDER_A = 'order-aaaa-0000-4000-8000-aaaaaaaaaaaa';
const ORDER_B = 'order-bbbb-0000-4000-8000-bbbbbbbbbbbb';
const NOW = 1_760_000_000_000;

const FORBIDDEN_PHRASES = [
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

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class FakeMarkerStorage implements OxygenMarkerStorage {
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

function lookupOk(available: boolean, reason?: string): OxygenLookupResult {
  return reason === undefined
    ? { ok: true, available }
    : { ok: true, available, reason };
}

function lookupErr(status: number, code?: string): OxygenLookupResult {
  return { ok: false, status, code };
}

function submitErr(status: number, code?: string): OxygenSubmitResult {
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

function createHarness(): Harness {
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

function propsFor(
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

async function resolveLookup(
  harness: Harness,
  index: number,
  result: OxygenLookupResult
): Promise<void> {
  await act(async () => {
    harness.lookups[index]?.resolve(result);
  });
}

async function resolveSubmit(
  harness: Harness,
  index: number,
  result: OxygenSubmitResult
): Promise<void> {
  await act(async () => {
    harness.submits[index]?.resolve(result);
  });
}

beforeEach(() => {
  window.sessionStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mount and lookup-on-resolve', () => {
  it('stays idle with a null orderId: zero fetch, markers kept', () => {
    const harness = createHarness();
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness, { orderId: null }))
    );
    expect(result.current.state).toBe('idle');
    expect(harness.lookup).not.toHaveBeenCalled();
    expect(harness.submit).not.toHaveBeenCalled();
    expect(harness.onSecureFormRequest).not.toHaveBeenCalled();
    expect(
      readOxygenHandoffMarker(harness.storage, ORDER_A, NOW)
    ).not.toBeNull();
  });

  it('waits out a loading session, then looks up on resolve', () => {
    const harness = createHarness();
    const { result, rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      {
        initialProps: propsFor(harness, {
          session: { status: 'loading' },
        }),
      }
    );
    expect(result.current.state).toBe('idle');
    expect(harness.lookup).not.toHaveBeenCalled();

    rerender(propsFor(harness, { session: { status: 'authenticated' } }));
    expect(result.current.state).toBe('checking');
    expect(harness.lookup).toHaveBeenCalledTimes(1);
    expect(harness.lookup).toHaveBeenCalledWith(ORDER_A);
  });

  it('looks up immediately when mounted with a resolved session', () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    expect(result.current.state).toBe('checking');
    expect(harness.lookup).toHaveBeenCalledTimes(1);
  });

  it('treats an initial guest session as resolved (lookup, not sign-out)', () => {
    const harness = createHarness();
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW - 1000);
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness, { session: { status: 'guest' } }))
    );
    // A marker is present, so the guest lookup resumes rather than checks.
    expect(result.current.state).toBe('resuming');
    expect(harness.lookup).toHaveBeenCalledTimes(1);
  });

  it('treats a first loading-to-guest resolve as resolve, without clearing', () => {
    const harness = createHarness();
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    writeOxygenHandoffMarker(harness.storage, ORDER_B, NOW);
    const { result, rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      {
        initialProps: propsFor(harness, {
          session: { status: 'loading' },
        }),
      }
    );
    rerender(propsFor(harness, { session: { status: 'guest' } }));
    expect(result.current.state).toBe('resuming');
    expect(harness.lookup).toHaveBeenCalledTimes(1);
    expect(harness.storage.keys()).toHaveLength(2);
  });

  it('emits zero submit and zero handoff until an explicit action', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    expect(result.current.state).toBe('ready');
    expect(harness.submit).not.toHaveBeenCalled();
    expect(harness.onSecureFormRequest).not.toHaveBeenCalled();
  });

  it('does not refetch when re-rendered with unchanged inputs', () => {
    const harness = createHarness();
    const { rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      { initialProps: propsFor(harness) }
    );
    rerender(propsFor(harness));
    rerender(propsFor(harness));
    expect(harness.lookup).toHaveBeenCalledTimes(1);
  });
});

describe('lookup settle paths', () => {
  it('resolves 200 available to ready', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    expect(result.current.state).toBe('ready');
    expect(result.current.reason).toBeUndefined();
    expect(result.current.recoveries).toEqual([]);
  });

  it('resolves a 200 deny to unavailable with the reason', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(false, 'oxygen_rollout_disabled'));
    expect(result.current.state).toBe('unavailable');
    expect(result.current.reason).toBe('oxygen_rollout_disabled');
  });

  it('resolves the guest deny to signin-required', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness, { session: { status: 'guest' } }))
    );
    await resolveLookup(
      harness,
      0,
      lookupOk(false, 'oxygen_guest_not_allowed')
    );
    expect(result.current.state).toBe('signin-required');
    expect(result.current.reason).toBe('oxygen_guest_not_allowed');
  });

  it('resolves 404 to idle and discards the order marker', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    // Another tab wrote a marker after the check started.
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    await resolveLookup(harness, 0, lookupErr(404));
    expect(result.current.state).toBe('idle');
    expect(harness.storage.getItem(oxygenHandoffMarkerKey(ORDER_A))).toBeNull();
  });

  it('resolves 401 to reason-less signin-required with the marker kept', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    await resolveLookup(harness, 0, lookupErr(401));
    expect(result.current.state).toBe('signin-required');
    expect(result.current.reason).toBeUndefined();
    expect(
      readOxygenHandoffMarker(harness.storage, ORDER_A, NOW)
    ).not.toBeNull();
  });

  it('resolves 400 to failed-with-no-recovery and logs the host bug once', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupErr(400));
    expect(result.current.state).toBe('failed');
    expect(result.current.recoveries).toEqual([]);
    expect(console.error).toHaveBeenCalledTimes(1);
    const logged = vi.mocked(console.error).mock.calls.flat().join(' ');
    expect(logged).not.toContain(ORDER_A);
  });

  it.each([
    429, 500, 503,
  ])('resolves %s to failed-with-recheck without logging', async (status) => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupErr(status));
    expect(result.current.state).toBe('failed');
    expect(result.current.recoveries).toEqual(['recheck']);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('resolves a network rejection to failed-with-recheck', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await act(async () => {
      harness.lookups[0]?.reject(new Error('network down'));
    });
    expect(result.current.state).toBe('failed');
    expect(result.current.recoveries).toEqual(['recheck']);
  });

  it('fails closed when lookup throws synchronously on mount', async () => {
    const harness = createHarness();
    harness.lookup.mockImplementationOnce(() => {
      throw new Error('host lookup blew up');
    });
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await act(async () => {});
    expect(result.current.state).toBe('failed');
    expect(result.current.recoveries).toEqual(['recheck']);
    // The shell stays functional: recheck issues a fresh lookup.
    act(() => {
      result.current.onRecheck();
    });
    expect(result.current.state).toBe('checking');
    expect(harness.lookup).toHaveBeenCalledTimes(2);
    await resolveLookup(harness, 0, lookupOk(true));
    expect(result.current.state).toBe('ready');
  });

  it('drops a stale lookup response after an order change (observable)', async () => {
    const harness = createHarness();
    const { result, rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      { initialProps: propsFor(harness) }
    );
    rerender(propsFor(harness, { orderId: ORDER_B }));
    expect(result.current.state).toBe('checking');
    expect(harness.lookup).toHaveBeenCalledTimes(2);
    // The ORDER_A response arrives late and must not apply.
    await resolveLookup(harness, 0, lookupOk(true));
    expect(result.current.state).toBe('checking');
    await resolveLookup(harness, 1, lookupOk(true));
    expect(result.current.state).toBe('ready');
  });
});

describe('resume-on-mount (GET-only)', () => {
  it('mounts with a valid marker into resuming without submit or handoff', () => {
    const harness = createHarness();
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    expect(result.current.state).toBe('resuming');
    expect(harness.lookup).toHaveBeenCalledTimes(1);
    expect(harness.lookup).toHaveBeenCalledWith(ORDER_A);
    expect(harness.submit).not.toHaveBeenCalled();
    expect(harness.onSecureFormRequest).not.toHaveBeenCalled();
  });

  it('consumes the marker on resume-complete', async () => {
    const harness = createHarness();
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    expect(result.current.state).toBe('ready');
    expect(harness.storage.getItem(oxygenHandoffMarkerKey(ORDER_A))).toBeNull();
  });

  it('keeps the marker on a resume deny', async () => {
    const harness = createHarness();
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(
      harness,
      0,
      lookupOk(false, 'oxygen_provider_unverified')
    );
    expect(result.current.state).toBe('unavailable');
    expect(
      readOxygenHandoffMarker(harness.storage, ORDER_A, NOW)
    ).not.toBeNull();
  });

  it('keeps the marker on a resume transient; recheck resumes again', async () => {
    const harness = createHarness();
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupErr(503));
    expect(result.current.state).toBe('failed');
    expect(result.current.recoveries).toEqual(['recheck']);
    expect(
      readOxygenHandoffMarker(harness.storage, ORDER_A, NOW)
    ).not.toBeNull();
    act(() => {
      result.current.onRecheck();
    });
    expect(result.current.state).toBe('resuming');
    expect(harness.lookup).toHaveBeenCalledTimes(2);
  });

  it('discards on resume-404 and lands idle', async () => {
    const harness = createHarness();
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupErr(404));
    expect(result.current.state).toBe('idle');
    expect(harness.storage.getItem(oxygenHandoffMarkerKey(ORDER_A))).toBeNull();
  });

  it.each([
    ['expired', NOW - OXYGEN_HANDOFF_MARKER_TTL_MS - 1],
    ['mismatched', NOW],
  ])('treats an invalid (%s) marker as idle + discard with zero fetch', async (_label, createdAt) => {
    const harness = createHarness();
    const orderId = _label === 'mismatched' ? 'another-order' : ORDER_A;
    harness.storage.setItem(
      oxygenHandoffMarkerKey(ORDER_A),
      JSON.stringify({ orderId, createdAt })
    );
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    expect(result.current.state).toBe('idle');
    expect(harness.lookup).not.toHaveBeenCalled();
    expect(harness.storage.getItem(oxygenHandoffMarkerKey(ORDER_A))).toBeNull();
  });

  it('treats a corrupt marker as idle + discard with zero fetch', () => {
    const harness = createHarness();
    harness.storage.setItem(oxygenHandoffMarkerKey(ORDER_A), '{corrupt');
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    expect(result.current.state).toBe('idle');
    expect(harness.lookup).not.toHaveBeenCalled();
    expect(harness.storage.getItem(oxygenHandoffMarkerKey(ORDER_A))).toBeNull();
  });
});

describe('session flips', () => {
  it('revalidates when the session flips to authenticated', async () => {
    const harness = createHarness();
    const { result, rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      {
        initialProps: propsFor(harness, { session: { status: 'guest' } }),
      }
    );
    await resolveLookup(
      harness,
      0,
      lookupOk(false, 'oxygen_guest_not_allowed')
    );
    expect(result.current.state).toBe('signin-required');
    rerender(propsFor(harness, { session: { status: 'authenticated' } }));
    expect(result.current.state).toBe('checking');
    expect(harness.lookup).toHaveBeenCalledTimes(2);
  });

  it('resets to idle + prefix-clear on sign-out (authenticated to guest)', async () => {
    const harness = createHarness();
    const { result, rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      { initialProps: propsFor(harness) }
    );
    await resolveLookup(harness, 0, lookupOk(true));
    expect(result.current.state).toBe('ready');
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    writeOxygenHandoffMarker(harness.storage, ORDER_B, NOW);
    harness.storage.setItem('unrelated-key', 'keep');
    rerender(propsFor(harness, { session: { status: 'guest' } }));
    expect(result.current.state).toBe('idle');
    expect(harness.storage.keys()).toEqual(['unrelated-key']);
    expect(harness.lookup).toHaveBeenCalledTimes(1);
  });

  it('treats authenticated-loading-guest as a sign-out (prefix-clear)', () => {
    const harness = createHarness();
    const { result, rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      { initialProps: propsFor(harness) }
    );
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    rerender(propsFor(harness, { session: { status: 'loading' } }));
    expect(result.current.state).toBe('idle');
    rerender(propsFor(harness, { session: { status: 'guest' } }));
    expect(result.current.state).toBe('idle');
    expect(harness.storage.keys()).toEqual([]);
  });

  it('suspends ready actions when session revalidation starts', async () => {
    const harness = createHarness();
    const { result, rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      { initialProps: propsFor(harness) }
    );
    await resolveLookup(harness, 0, lookupOk(true));
    rerender(propsFor(harness, { session: { status: 'loading' } }));
    expect(result.current.state).toBe('idle');
    act(() => result.current.onSubmit());
    expect(harness.submit).not.toHaveBeenCalled();
    expect(harness.lookup).toHaveBeenCalledTimes(1);
  });

  it('idles with markers kept when the order clears', async () => {
    const harness = createHarness();
    const { result, rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      { initialProps: propsFor(harness) }
    );
    await resolveLookup(harness, 0, lookupOk(true));
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    rerender(propsFor(harness, { orderId: null }));
    expect(result.current.state).toBe('idle');
    expect(
      readOxygenHandoffMarker(harness.storage, ORDER_A, NOW)
    ).not.toBeNull();
  });

  it('drops a stale submit after sign-out mid-POST', async () => {
    const harness = createHarness();
    const { result, rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      { initialProps: propsFor(harness) }
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    expect(result.current.state).toBe('initiating');
    rerender(propsFor(harness, { session: { status: 'guest' } }));
    expect(result.current.state).toBe('idle');
    await resolveSubmit(harness, 0, { ok: true });
    expect(result.current.state).toBe('idle');
    expect(harness.onSecureFormRequest).not.toHaveBeenCalled();
  });

  it('drops the late lookup after a guest-to-authenticated flip mid-lookup', async () => {
    const harness = createHarness();
    const { result, rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      {
        initialProps: propsFor(harness, { session: { status: 'guest' } }),
      }
    );
    expect(result.current.state).toBe('checking');
    rerender(propsFor(harness, { session: { status: 'authenticated' } }));
    expect(result.current.state).toBe('checking');
    expect(harness.lookup).toHaveBeenCalledTimes(2);
    await resolveLookup(harness, 0, lookupOk(true));
    expect(result.current.state).toBe('checking');
    await resolveLookup(harness, 1, lookupOk(true));
    expect(result.current.state).toBe('ready');
  });
});

describe('notifySessionEvent', () => {
  it('resets to idle + prefix-clear for a guest session', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness, { session: { status: 'guest' } }))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    expect(result.current.state).toBe('ready');
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    writeOxygenHandoffMarker(harness.storage, ORDER_B, NOW);
    act(() => {
      result.current.notifySessionEvent();
    });
    expect(result.current.state).toBe('idle');
    expect(harness.storage.keys()).toEqual([]);
  });

  it('revalidates for an authenticated session', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupErr(503));
    expect(result.current.state).toBe('failed');
    act(() => {
      result.current.notifySessionEvent();
    });
    expect(result.current.state).toBe('checking');
    expect(harness.lookup).toHaveBeenCalledTimes(2);
  });

  it('idles without fetching or clearing for a loading session', async () => {
    const harness = createHarness();
    const { result, rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      { initialProps: propsFor(harness) }
    );
    await resolveLookup(harness, 0, lookupOk(true));
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    rerender(propsFor(harness, { session: { status: 'loading' } }));
    expect(result.current.state).toBe('idle');
    act(() => {
      result.current.notifySessionEvent();
    });
    expect(result.current.state).toBe('idle');
    expect(harness.lookup).toHaveBeenCalledTimes(1);
    expect(
      readOxygenHandoffMarker(harness.storage, ORDER_A, NOW)
    ).not.toBeNull();
  });

  it('is safe with a null orderId', () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness, { orderId: null }))
    );
    act(() => {
      result.current.notifySessionEvent();
    });
    expect(result.current.state).toBe('idle');
    expect(harness.lookup).not.toHaveBeenCalled();
  });

  it('abandons an in-flight POST when a session event hits initiating', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    expect(result.current.state).toBe('initiating');
    act(() => {
      result.current.notifySessionEvent();
    });
    expect(result.current.state).toBe('checking');
    expect(harness.lookup).toHaveBeenCalledTimes(2);
    await resolveSubmit(harness, 0, { ok: true });
    expect(result.current.state).toBe('checking');
    expect(harness.onSecureFormRequest).not.toHaveBeenCalled();
    expect(harness.storage.getItem(oxygenHandoffMarkerKey(ORDER_A))).toBeNull();
    await resolveLookup(harness, 1, lookupOk(true));
    expect(result.current.state).toBe('ready');
  });
});

describe('onSignin and onRecheck', () => {
  it('exposes a stable signin no-op (host owns navigation)', async () => {
    const harness = createHarness();
    const { result, rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      {
        initialProps: propsFor(harness, { session: { status: 'guest' } }),
      }
    );
    await resolveLookup(
      harness,
      0,
      lookupOk(false, 'oxygen_guest_not_allowed')
    );
    const first = result.current.onSignin;
    act(() => {
      result.current.onSignin();
    });
    expect(result.current.state).toBe('signin-required');
    expect(harness.lookup).toHaveBeenCalledTimes(1);
    expect(harness.submit).not.toHaveBeenCalled();
    rerender(propsFor(harness, { session: { status: 'guest' } }));
    expect(result.current.onSignin).toBe(first);
  });

  it('rechecks from unavailable and failed-with-recheck', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(false, 'oxygen_rollout_disabled'));
    act(() => {
      result.current.onRecheck();
    });
    expect(result.current.state).toBe('checking');
    expect(harness.lookup).toHaveBeenCalledTimes(2);
    await resolveLookup(harness, 1, lookupErr(500));
    act(() => {
      result.current.onRecheck();
    });
    expect(result.current.state).toBe('checking');
    expect(harness.lookup).toHaveBeenCalledTimes(3);
  });

  it('ignores recheck where it is not offered', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    act(() => {
      result.current.onRecheck();
    });
    expect(result.current.state).toBe('checking');
    expect(harness.lookup).toHaveBeenCalledTimes(1);
    await resolveLookup(harness, 0, lookupErr(400));
    act(() => {
      result.current.onRecheck();
    });
    expect(result.current.state).toBe('failed');
    expect(harness.lookup).toHaveBeenCalledTimes(1);
  });
});

describe('onSubmit guards and settle paths', () => {
  it('submits once per intent with a single fresh nonce', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    expect(result.current.state).toBe('initiating');
    expect(harness.submit).toHaveBeenCalledTimes(1);
    expect(harness.submit).toHaveBeenCalledWith({
      orderId: ORDER_A,
      nonce: 'nonce-1',
    });
    expect(harness.generateNonce).toHaveBeenCalledTimes(1);
  });

  it('ignores an in-flight repeat (double-click): one call, one nonce', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
      result.current.onSubmit();
    });
    act(() => {
      result.current.onSubmit();
    });
    expect(harness.submit).toHaveBeenCalledTimes(1);
    expect(harness.generateNonce).toHaveBeenCalledTimes(1);
    expect(harness.nonces).toEqual(['nonce-1']);
  });

  it('ignores submit where it is not offered', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    act(() => {
      result.current.onSubmit();
    });
    expect(harness.submit).not.toHaveBeenCalled();
    await resolveLookup(harness, 0, lookupOk(false, 'oxygen_rollout_disabled'));
    act(() => {
      result.current.onSubmit();
    });
    expect(harness.submit).not.toHaveBeenCalled();
    expect(harness.generateNonce).not.toHaveBeenCalled();
  });

  it('hands off on 2xx: marker written, then the secure-form callback fires once', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 0, { ok: true });
    expect(result.current.state).toBe('handed-off');
    expect(readOxygenHandoffMarker(harness.storage, ORDER_A, NOW)).toEqual({
      orderId: ORDER_A,
      createdAt: NOW,
    });
    expect(harness.onSecureFormRequest).toHaveBeenCalledTimes(1);
    expect(harness.handoffs[0]).toEqual({
      orderId: ORDER_A,
      nonce: 'nonce-1',
      issuedAt: NOW,
    });
    expect(Object.keys(harness.handoffs[0] ?? {}).sort()).toEqual([
      'issuedAt',
      'nonce',
      'orderId',
    ]);
  });

  it('writes the marker before the handoff callback fires', async () => {
    const harness = createHarness();
    let markerVisibleAtFire: unknown = 'unobserved';
    harness.onSecureFormRequest.mockImplementation(() => {
      markerVisibleAtFire = readOxygenHandoffMarker(
        harness.storage,
        ORDER_A,
        NOW
      );
    });
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 0, { ok: true });
    expect(markerVisibleAtFire).toEqual({ orderId: ORDER_A, createdAt: NOW });
  });

  it('fails safely with recheck only when secure-form navigation throws', async () => {
    const harness = createHarness();
    harness.onSecureFormRequest.mockImplementation(() => {
      throw new Error('private navigation details');
    });
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => result.current.onSubmit());
    await resolveSubmit(harness, 0, { ok: true });
    expect(result.current.state).toBe('failed');
    expect(result.current.recoveries).toEqual(['recheck']);
    expect(harness.onSecureFormRequest).toHaveBeenCalledTimes(1);
    expect(
      readOxygenHandoffMarker(harness.storage, ORDER_A, NOW)
    ).not.toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      '[oxygen] secure-form handoff failed'
    );
    act(() => result.current.onSubmit());
    expect(harness.submit).toHaveBeenCalledTimes(1);
    act(() => result.current.onRecheck());
    expect(result.current.state).toBe('resuming');
    expect(harness.lookup).toHaveBeenCalledTimes(2);
  });

  it('ignores 2xx payload fields: no server ids enter the handoff', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 0, {
      ok: true,
      attemptId: 'att_should_never_echo',
    } as unknown as OxygenSubmitResult);
    expect(result.current.state).toBe('handed-off');
    expect(JSON.stringify(harness.handoffs[0])).not.toContain(
      'att_should_never_echo'
    );
  });

  it('fires the handoff exactly once across re-renders', async () => {
    const harness = createHarness();
    const { result, rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      { initialProps: propsFor(harness) }
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 0, { ok: true });
    rerender(propsFor(harness));
    rerender(propsFor(harness));
    expect(harness.onSecureFormRequest).toHaveBeenCalledTimes(1);
  });

  it('fires again for a later successful submit (once per submit, not once ever)', async () => {
    const harness = createHarness();
    const { result, rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      { initialProps: propsFor(harness) }
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 0, { ok: true });
    rerender(propsFor(harness, { orderId: ORDER_B }));
    await resolveLookup(harness, 1, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 1, { ok: true });
    expect(harness.onSecureFormRequest).toHaveBeenCalledTimes(2);
    expect(harness.handoffs[1]).toEqual({
      orderId: ORDER_B,
      nonce: 'nonce-2',
      issuedAt: NOW,
    });
  });

  it('resolves a coded 403 to unavailable with the reason', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 0, submitErr(403, 'oxygen_not_configured'));
    expect(result.current.state).toBe('unavailable');
    expect(result.current.reason).toBe('oxygen_not_configured');
    expect(harness.onSecureFormRequest).not.toHaveBeenCalled();
  });

  it('resolves a codeless 403 to failed-with-both, never unavailable', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 0, submitErr(403));
    expect(result.current.state).toBe('failed');
    expect(result.current.recoveries).toEqual(['recheck', 'resubmit']);
  });

  it('never fires the handoff on 503 (Phase A dormant)', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 0, submitErr(503));
    expect(result.current.state).toBe('failed');
    expect(result.current.recoveries).toEqual(['recheck', 'resubmit']);
    expect(harness.onSecureFormRequest).not.toHaveBeenCalled();
    expect(harness.storage.getItem(oxygenHandoffMarkerKey(ORDER_A))).toBeNull();
  });

  it('resolves submit 404 to idle + discard', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 0, submitErr(404));
    expect(result.current.state).toBe('idle');
    expect(harness.storage.getItem(oxygenHandoffMarkerKey(ORDER_A))).toBeNull();
  });

  it('resolves submit 401 to signin-required with the marker kept', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 0, submitErr(401));
    expect(result.current.state).toBe('signin-required');
    expect(
      readOxygenHandoffMarker(harness.storage, ORDER_A, NOW)
    ).not.toBeNull();
  });

  it('resolves submit 400 to failed-with-no-recovery and logs once', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 0, submitErr(400));
    expect(result.current.state).toBe('failed');
    expect(result.current.recoveries).toEqual([]);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('resolves a submit rejection to failed-with-both', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    await act(async () => {
      harness.submits[0]?.reject(new Error('network down'));
    });
    expect(result.current.state).toBe('failed');
    expect(result.current.recoveries).toEqual(['recheck', 'resubmit']);
  });

  it('resubmits from failed-with-resubmit with a fresh nonce', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 0, submitErr(503));
    act(() => {
      result.current.onSubmit();
    });
    expect(result.current.state).toBe('initiating');
    expect(harness.submit).toHaveBeenCalledTimes(2);
    expect(harness.submit).toHaveBeenNthCalledWith(2, {
      orderId: ORDER_A,
      nonce: 'nonce-2',
    });
  });

  it('hands off on the resubmit after a 503 (single fire, fresh nonce)', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 0, submitErr(503));
    expect(result.current.state).toBe('failed');
    expect(harness.onSecureFormRequest).not.toHaveBeenCalled();
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 1, { ok: true });
    expect(result.current.state).toBe('handed-off');
    expect(harness.onSecureFormRequest).toHaveBeenCalledTimes(1);
    expect(harness.handoffs[0]).toEqual({
      orderId: ORDER_A,
      nonce: 'nonce-2',
      issuedAt: NOW,
    });
    expect(readOxygenHandoffMarker(harness.storage, ORDER_A, NOW)).toEqual({
      orderId: ORDER_A,
      createdAt: NOW,
    });
  });

  it('fails closed when generateNonce throws synchronously', async () => {
    const harness = createHarness();
    harness.generateNonce.mockImplementationOnce(() => {
      throw new Error('no entropy');
    });
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    expect(result.current.state).toBe('failed');
    expect(result.current.recoveries).toEqual(['recheck', 'resubmit']);
    expect(harness.submit).not.toHaveBeenCalled();
    // Submits are not wedged: the retry mints a fresh nonce and posts.
    act(() => {
      result.current.onSubmit();
    });
    expect(result.current.state).toBe('initiating');
    expect(harness.submit).toHaveBeenCalledTimes(1);
    expect(harness.submit).toHaveBeenCalledWith({
      orderId: ORDER_A,
      nonce: 'nonce-1',
    });
  });

  it('fails closed when submit throws synchronously', async () => {
    const harness = createHarness();
    harness.submit.mockImplementationOnce(() => {
      throw new Error('host submit blew up');
    });
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    await act(async () => {});
    expect(result.current.state).toBe('failed');
    expect(result.current.recoveries).toEqual(['recheck', 'resubmit']);
    // The shell stays functional: resubmit posts again and can hand off.
    act(() => {
      result.current.onSubmit();
    });
    expect(harness.submit).toHaveBeenCalledTimes(2);
    await resolveSubmit(harness, 0, { ok: true });
    expect(result.current.state).toBe('handed-off');
    expect(harness.onSecureFormRequest).toHaveBeenCalledTimes(1);
  });

  it('exits initiating on order change mid-POST and drops the late response', async () => {
    const harness = createHarness();
    const { result, rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      { initialProps: propsFor(harness) }
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    expect(result.current.state).toBe('initiating');
    rerender(propsFor(harness, { orderId: ORDER_B }));
    expect(result.current.state).toBe('checking');
    await resolveSubmit(harness, 0, { ok: true });
    expect(result.current.state).toBe('checking');
    expect(harness.onSecureFormRequest).not.toHaveBeenCalled();
    expect(harness.storage.getItem(oxygenHandoffMarkerKey(ORDER_A))).toBeNull();
    await resolveLookup(harness, 1, lookupOk(true));
    expect(result.current.state).toBe('ready');
    // The abandoned POST must not wedge later submits.
    act(() => {
      result.current.onSubmit();
    });
    expect(harness.submit).toHaveBeenCalledTimes(2);
  });

  it('revalidates to resuming when the new order carries a marker', async () => {
    const harness = createHarness();
    const { result, rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      { initialProps: propsFor(harness) }
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    writeOxygenHandoffMarker(harness.storage, ORDER_B, NOW);
    rerender(propsFor(harness, { orderId: ORDER_B }));
    expect(result.current.state).toBe('resuming');
    expect(harness.lookup).toHaveBeenCalledTimes(2);
    expect(harness.lookup).toHaveBeenNthCalledWith(2, ORDER_B);
  });
});

describe('onDismiss', () => {
  it('dismisses ready to idle + clear', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    act(() => {
      result.current.onDismiss();
    });
    expect(result.current.state).toBe('idle');
    expect(harness.storage.getItem(oxygenHandoffMarkerKey(ORDER_A))).toBeNull();
  });

  it('dismisses handed-off to idle + clear (explicit abandon)', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 0, { ok: true });
    expect(result.current.state).toBe('handed-off');
    act(() => {
      result.current.onDismiss();
    });
    expect(result.current.state).toBe('idle');
    expect(harness.storage.getItem(oxygenHandoffMarkerKey(ORDER_A))).toBeNull();
  });

  it('dismisses unavailable to idle + clear', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    await resolveLookup(harness, 0, lookupOk(false, 'oxygen_rollout_disabled'));
    expect(result.current.state).toBe('unavailable');
    expect(
      readOxygenHandoffMarker(harness.storage, ORDER_A, NOW)
    ).not.toBeNull();
    act(() => {
      result.current.onDismiss();
    });
    expect(result.current.state).toBe('idle');
    expect(harness.storage.getItem(oxygenHandoffMarkerKey(ORDER_A))).toBeNull();
  });

  it('dismisses signin-required to idle + clear', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    await resolveLookup(harness, 0, lookupErr(401));
    expect(result.current.state).toBe('signin-required');
    expect(
      readOxygenHandoffMarker(harness.storage, ORDER_A, NOW)
    ).not.toBeNull();
    act(() => {
      result.current.onDismiss();
    });
    expect(result.current.state).toBe('idle');
    expect(harness.storage.getItem(oxygenHandoffMarkerKey(ORDER_A))).toBeNull();
  });

  it('ignores dismiss while initiating (do-not-close window)', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    act(() => {
      result.current.onDismiss();
    });
    expect(result.current.state).toBe('initiating');
    await resolveSubmit(harness, 0, { ok: true });
    expect(result.current.state).toBe('handed-off');
    expect(harness.onSecureFormRequest).toHaveBeenCalledTimes(1);
  });

  it('ignores dismiss while idle without clearing markers', () => {
    const harness = createHarness();
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness, { orderId: null }))
    );
    act(() => {
      result.current.onDismiss();
    });
    expect(result.current.state).toBe('idle');
    expect(
      readOxygenHandoffMarker(harness.storage, ORDER_A, NOW)
    ).not.toBeNull();
  });

  it('dismisses checking to idle + clear and drops the late lookup', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    act(() => {
      result.current.onDismiss();
    });
    expect(result.current.state).toBe('idle');
    expect(harness.storage.getItem(oxygenHandoffMarkerKey(ORDER_A))).toBeNull();
    await resolveLookup(harness, 0, lookupOk(true));
    expect(result.current.state).toBe('idle');
  });

  it('dismisses resuming to idle + clear', async () => {
    const harness = createHarness();
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    expect(result.current.state).toBe('resuming');
    act(() => {
      result.current.onDismiss();
    });
    expect(result.current.state).toBe('idle');
    expect(harness.storage.getItem(oxygenHandoffMarkerKey(ORDER_A))).toBeNull();
  });

  it('dismisses failed to idle + clear', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupErr(500));
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    act(() => {
      result.current.onDismiss();
    });
    expect(result.current.state).toBe('idle');
    expect(harness.storage.getItem(oxygenHandoffMarkerKey(ORDER_A))).toBeNull();
  });
});

describe('input-change revalidation', () => {
  it('checks when a null orderId becomes set', () => {
    const harness = createHarness();
    const { result, rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      { initialProps: propsFor(harness, { orderId: null }) }
    );
    expect(result.current.state).toBe('idle');
    rerender(propsFor(harness, { orderId: ORDER_A }));
    expect(result.current.state).toBe('checking');
    expect(harness.lookup).toHaveBeenCalledTimes(1);
    expect(harness.lookup).toHaveBeenCalledWith(ORDER_A);
  });

  it('rechecks when the order changes from ready', async () => {
    const harness = createHarness();
    const { result, rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      { initialProps: propsFor(harness) }
    );
    await resolveLookup(harness, 0, lookupOk(true));
    expect(result.current.state).toBe('ready');
    rerender(propsFor(harness, { orderId: ORDER_B }));
    expect(result.current.state).toBe('checking');
    expect(harness.lookup).toHaveBeenCalledTimes(2);
    expect(harness.lookup).toHaveBeenNthCalledWith(2, ORDER_B);
  });

  it('resumes when a session event hits handed-off with its marker present', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 0, { ok: true });
    expect(result.current.state).toBe('handed-off');
    act(() => {
      result.current.notifySessionEvent();
    });
    expect(result.current.state).toBe('resuming');
    expect(harness.lookup).toHaveBeenCalledTimes(2);
  });

  it('keeps the marker on a resume 401', async () => {
    const harness = createHarness();
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupErr(401));
    expect(result.current.state).toBe('signin-required');
    expect(result.current.reason).toBeUndefined();
    expect(
      readOxygenHandoffMarker(harness.storage, ORDER_A, NOW)
    ).not.toBeNull();
  });

  it('idles with the marker kept when the order clears mid-POST', async () => {
    const harness = createHarness();
    const { result, rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      { initialProps: propsFor(harness) }
    );
    await resolveLookup(harness, 0, lookupOk(true));
    writeOxygenHandoffMarker(harness.storage, ORDER_A, NOW);
    act(() => {
      result.current.onSubmit();
    });
    expect(result.current.state).toBe('initiating');
    rerender(propsFor(harness, { orderId: null }));
    expect(result.current.state).toBe('idle');
    expect(
      readOxygenHandoffMarker(harness.storage, ORDER_A, NOW)
    ).not.toBeNull();
    await resolveSubmit(harness, 0, { ok: true });
    expect(result.current.state).toBe('idle');
    expect(harness.submit).toHaveBeenCalledTimes(1);
    expect(harness.onSecureFormRequest).not.toHaveBeenCalled();
  });
});

describe('storage and nonce defaults', () => {
  it('hands off without a marker when storage is explicitly null', async () => {
    const harness = createHarness();
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness, { storage: null }))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 0, { ok: true });
    expect(result.current.state).toBe('handed-off');
    expect(harness.onSecureFormRequest).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('hands off through throwing storage (quota) without crashing', async () => {
    const harness = createHarness();
    const throwing: OxygenMarkerStorage = {
      get length(): number {
        return 0;
      },
      key: () => null,
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    const { result } = renderHook(() =>
      useOxygenInteraction(propsFor(harness, { storage: throwing }))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 0, { ok: true });
    expect(result.current.state).toBe('handed-off');
    expect(harness.onSecureFormRequest).toHaveBeenCalledTimes(1);
  });

  it('defaults to the tab store when storage is omitted', async () => {
    const harness = createHarness();
    const { storage: _ignored, ...withoutStorage } = propsFor(harness);
    expect(_ignored).toBeDefined();
    const { result } = renderHook(() => useOxygenInteraction(withoutStorage));
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 0, { ok: true });
    expect(
      window.sessionStorage.getItem(oxygenHandoffMarkerKey(ORDER_A))
    ).not.toBeNull();
  });

  it('defaults nonces to UUIDs, unique per intent', async () => {
    const harness = createHarness();
    const { generateNonce: _ignored, ...withoutNonce } = propsFor(harness);
    expect(_ignored).toBeDefined();
    const { result } = renderHook(() => useOxygenInteraction(withoutNonce));
    const uuidV4 =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => {
      result.current.onSubmit();
    });
    await resolveSubmit(harness, 0, submitErr(503));
    act(() => {
      result.current.onSubmit();
    });
    const first = vi.mocked(harness.submit).mock.calls[0]?.[0]?.nonce;
    const second = vi.mocked(harness.submit).mock.calls[1]?.[0]?.nonce;
    expect(first).toMatch(uuidV4);
    expect(second).toMatch(uuidV4);
    expect(first).not.toBe(second);
  });
});

describe('use-oxygen-interaction module shape (static)', () => {
  const source = readFileSync(
    resolve(
      process.cwd(),
      'src/components/payments/oxygen/use-oxygen-interaction.ts'
    ),
    'utf8'
  );

  it('is a client module', () => {
    expect(source).toContain("'use client'");
  });

  it('never fetches and never touches routing or foreign stores', () => {
    expect(source).not.toContain('global.fetch');
    expect(source).not.toMatch(/(^|[^A-Za-z])fetch\(/m);
    expect(source).not.toContain('XMLHttpRequest');
    expect(source).not.toContain('next/router');
    expect(source).not.toContain('next/navigation');
    expect(source).not.toContain('localStorage');
    expect(source).not.toContain('transport');
    expect(source).not.toContain('token-cache');
    expect(source).not.toContain('posthog');
    expect(source).not.toContain('captureClientEvent');
  });

  it('keeps approval language out of the module', () => {
    for (const phrase of FORBIDDEN_PHRASES) {
      expect(source.toLowerCase()).not.toContain(phrase);
    }
  });

  it('mentions no provider, loan, attempt, or chat-transcript surface', () => {
    expect(source).not.toMatch(/provider/i);
    expect(source).not.toMatch(/loan/i);
    expect(source).not.toContain('attemptId');
    expect(source).not.toContain('transcript');
  });
});

describe('handoff lifecycle regressions', () => {
  it('ignores submit success after unmount without writing a marker', async () => {
    const harness = createHarness();
    const { result, unmount } = renderHook(() =>
      useOxygenInteraction(propsFor(harness))
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => result.current.onSubmit());
    unmount();
    await resolveSubmit(harness, 0, { ok: true });
    expect(harness.handoffs).toEqual([]);
    expect(harness.storage.keys()).toEqual([]);
  });

  it('ignores pending success while loading and revalidates the new order', async () => {
    const harness = createHarness();
    const { result, rerender } = renderHook(
      (props: UseOxygenInteractionOptions) => useOxygenInteraction(props),
      { initialProps: propsFor(harness) }
    );
    await resolveLookup(harness, 0, lookupOk(true));
    act(() => result.current.onSubmit());
    rerender(propsFor(harness, { session: { status: 'loading' } }));
    await resolveSubmit(harness, 0, { ok: true });
    expect(harness.handoffs).toEqual([]);
    expect(harness.storage.keys()).toEqual([]);
    expect(result.current.state).toBe('idle');
    rerender(
      propsFor(harness, { orderId: ORDER_B, session: { status: 'loading' } })
    );
    expect(harness.lookup).toHaveBeenCalledTimes(1);
    rerender(propsFor(harness, { orderId: ORDER_B }));
    expect(harness.lookup).toHaveBeenLastCalledWith(ORDER_B);
    await resolveLookup(harness, 1, lookupOk(true));
    expect(result.current.state).toBe('ready');
  });
});
