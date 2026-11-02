import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { captureClientEvent } from '@/lib/posthog/capture-client-event';
import {
  applyOxygenDismiss,
  clearAllOxygenHandoffMarkers,
  clearOxygenHandoffMarker,
  generateOxygenNonce,
  getOxygenInteractionActions,
  getOxygenInteractionCopy,
  idleInteractionSnapshot,
  isOxygenInteractionReason,
  isOxygenInteractionState,
  mapOxygenLookupNetworkFailure,
  mapOxygenLookupResult,
  mapOxygenSubmitNetworkFailure,
  mapOxygenSubmitResult,
  OXYGEN_HANDOFF_MARKER_PREFIX,
  OXYGEN_HANDOFF_MARKER_TTL_MS,
  OXYGEN_INTERACTION_ACTION_LABELS,
  OXYGEN_INTERACTION_FALLBACK_COPY,
  OXYGEN_INTERACTION_REASON_COPY,
  OXYGEN_INTERACTION_REASON_LIST,
  OXYGEN_INTERACTION_STATE_LIST,
  type OxygenFailedRecovery,
  type OxygenInteractionAction,
  type OxygenInteractionReason,
  type OxygenInteractionSnapshot,
  type OxygenInteractionState,
  type OxygenLookupResult,
  type OxygenMarkerStorage,
  type OxygenSubmitResult,
  oxygenHandoffMarkerKey,
  readOxygenHandoffMarker,
  snapshotForRevalidate,
  toAnalyticsEvent,
  toChatMessageText,
  writeOxygenHandoffMarker,
} from './interaction';

// S-04 §403 message table, copied verbatim from the design doc. The reason
// strings are the specified API (same treatment as reason codes).
const S04_MESSAGE_TABLE: Array<{
  reason: OxygenInteractionReason;
  message: string;
}> = [
  {
    reason: 'oxygen_identity_mismatch',
    message: 'This order cannot use Oxygen.',
  },
  {
    reason: 'oxygen_environment_mismatch',
    message: 'Oxygen is not available here.',
  },
  {
    reason: 'oxygen_guest_not_allowed',
    message: 'Sign in to continue with Oxygen.',
  },
  {
    reason: 'oxygen_not_configured',
    message: 'Oxygen is not available for this store.',
  },
  {
    reason: 'oxygen_rollout_disabled',
    message: 'Oxygen is not available right now.',
  },
  {
    reason: 'oxygen_provider_unverified',
    message: 'Oxygen is not available for this store.',
  },
];

const ALL_STATES: OxygenInteractionState[] = [
  'idle',
  'checking',
  'ready',
  'unavailable',
  'signin-required',
  'initiating',
  'handed-off',
  'resuming',
  'failed',
];

const SIX_REASONS: OxygenInteractionReason[] = [
  'oxygen_identity_mismatch',
  'oxygen_environment_mismatch',
  'oxygen_guest_not_allowed',
  'oxygen_not_configured',
  'oxygen_rollout_disabled',
  'oxygen_provider_unverified',
];

// D-05 sweep list: availability wording only, never credit-decision wording.
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

const FIXTURE_ORDER_ID = 'order-fixture-9f2c4b7a-0000-4000-8000-aaaaaaaaaaaa';
const FIXTURE_EMAIL = 'shell-fixture@example.com';

function failedSnapshot(
  recoveries: OxygenFailedRecovery[]
): OxygenInteractionSnapshot {
  return { state: 'failed', recoveries };
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

describe('machine states and reason taxonomy', () => {
  it('exposes exactly the nine machine states', () => {
    expect([...OXYGEN_INTERACTION_STATE_LIST]).toEqual(ALL_STATES);
  });

  it('exposes exactly the six S-03 reasons', () => {
    expect([...OXYGEN_INTERACTION_REASON_LIST]).toEqual(SIX_REASONS);
  });

  it.each(ALL_STATES)('accepts %s as a machine state', (state) => {
    expect(isOxygenInteractionState(state)).toBe(true);
  });

  it('rejects non-state inputs (ids, typos, non-strings)', () => {
    expect(isOxygenInteractionState(FIXTURE_ORDER_ID)).toBe(false);
    expect(isOxygenInteractionState('interrupted')).toBe(false);
    expect(isOxygenInteractionState('approved')).toBe(false);
    expect(isOxygenInteractionState('')).toBe(false);
    expect(isOxygenInteractionState(undefined)).toBe(false);
    expect(isOxygenInteractionState(null)).toBe(false);
    expect(isOxygenInteractionState(42)).toBe(false);
    expect(isOxygenInteractionState({})).toBe(false);
  });

  it.each(SIX_REASONS)('accepts %s as a reason', (reason) => {
    expect(isOxygenInteractionReason(reason)).toBe(true);
  });

  it('rejects non-reason inputs', () => {
    expect(isOxygenInteractionReason(FIXTURE_ORDER_ID)).toBe(false);
    expect(isOxygenInteractionReason(FIXTURE_EMAIL)).toBe(false);
    expect(isOxygenInteractionReason('oxygen_provider_unavailable')).toBe(
      false
    );
    expect(isOxygenInteractionReason('')).toBe(false);
    expect(isOxygenInteractionReason(undefined)).toBe(false);
    expect(isOxygenInteractionReason(null)).toBe(false);
    expect(isOxygenInteractionReason(0)).toBe(false);
  });

  it('builds a fresh idle snapshot on every call', () => {
    expect(idleInteractionSnapshot()).toEqual({
      state: 'idle',
      recoveries: [],
    });
    expect(idleInteractionSnapshot()).not.toBe(idleInteractionSnapshot());
    expect(idleInteractionSnapshot().recoveries).not.toBe(
      idleInteractionSnapshot().recoveries
    );
  });
});

describe('reason copy (S-04 verbatim)', () => {
  it.each(S04_MESSAGE_TABLE)('renders $reason verbatim from the S-04 table', ({
    reason,
    message,
  }) => {
    expect(OXYGEN_INTERACTION_REASON_COPY[reason]).toBe(message);
  });

  it('covers exactly the six reasons', () => {
    expect(Object.keys(OXYGEN_INTERACTION_REASON_COPY).sort()).toEqual(
      [...SIX_REASONS].sort()
    );
  });
});

describe('getOxygenInteractionCopy', () => {
  it.each(
    S04_MESSAGE_TABLE
  )('prefers the reason message for unavailable + $reason', ({
    reason,
    message,
  }) => {
    expect(getOxygenInteractionCopy('unavailable', reason)).toBe(message);
  });

  it('uses the guest message for signin-required with the guest reason', () => {
    expect(
      getOxygenInteractionCopy('signin-required', 'oxygen_guest_not_allowed')
    ).toBe('Sign in to continue with Oxygen.');
  });

  it('falls back to the guest message for reason-less signin-required (401 path)', () => {
    expect(getOxygenInteractionCopy('signin-required')).toBe(
      'Sign in to continue with Oxygen.'
    );
  });

  it('pins every reason-less state default', () => {
    expect(getOxygenInteractionCopy('checking')).toBe(
      'Checking Oxygen availability…'
    );
    expect(getOxygenInteractionCopy('ready')).toBe(
      'Oxygen is available for this order.'
    );
    expect(getOxygenInteractionCopy('initiating')).toBe(
      'Starting Oxygen… Do not close this window.'
    );
    expect(getOxygenInteractionCopy('handed-off')).toBe(
      'Continue with Oxygen in the secure form.'
    );
    expect(getOxygenInteractionCopy('failed')).toBe('Something went wrong.');
    expect(getOxygenInteractionCopy('idle')).toBe('Something went wrong.');
    expect(getOxygenInteractionCopy('unavailable')).toBe(
      'Something went wrong.'
    );
  });

  it('covers "continue where you left off" while resuming', () => {
    expect(getOxygenInteractionCopy('resuming').toLowerCase()).toContain(
      'continue where you left off'
    );
  });

  it('keeps the do-not-close instruction while initiating', () => {
    expect(getOxygenInteractionCopy('initiating').toLowerCase()).toContain(
      'do not close'
    );
  });

  it('never echoes an unknown reason; fails safe to the status default', () => {
    expect(
      getOxygenInteractionCopy(
        'unavailable',
        FIXTURE_ORDER_ID as OxygenInteractionReason
      )
    ).toBe('Something went wrong.');
    expect(
      getOxygenInteractionCopy(
        'ready',
        FIXTURE_ORDER_ID as OxygenInteractionReason
      )
    ).toBe('Oxygen is available for this order.');
  });

  it('exposes the generic fallback copy', () => {
    expect(OXYGEN_INTERACTION_FALLBACK_COPY).toBe('Something went wrong.');
  });
});

describe('getOxygenInteractionActions', () => {
  it('offers nothing while idle, checking, resuming, or initiating', () => {
    for (const state of [
      'idle',
      'checking',
      'resuming',
      'initiating',
    ] as OxygenInteractionState[]) {
      expect(getOxygenInteractionActions({ state, recoveries: [] })).toEqual(
        []
      );
    }
  });

  it('offers submit + dismiss while ready', () => {
    expect(
      getOxygenInteractionActions({ state: 'ready', recoveries: [] })
    ).toEqual(['submit', 'dismiss']);
  });

  it('offers recheck + dismiss while unavailable', () => {
    expect(
      getOxygenInteractionActions({
        state: 'unavailable',
        reason: 'oxygen_rollout_disabled',
        recoveries: [],
      })
    ).toEqual(['recheck', 'dismiss']);
  });

  it('offers signin + dismiss while signin-required', () => {
    expect(
      getOxygenInteractionActions({ state: 'signin-required', recoveries: [] })
    ).toEqual(['signin', 'dismiss']);
  });

  it('offers dismiss only once handed-off (explicit abandon)', () => {
    expect(
      getOxygenInteractionActions({ state: 'handed-off', recoveries: [] })
    ).toEqual(['dismiss']);
  });

  it('offers dismiss only for failed-with-no-recovery (400 path)', () => {
    expect(getOxygenInteractionActions(failedSnapshot([]))).toEqual([
      'dismiss',
    ]);
  });

  it('offers recheck + dismiss for failed-with-recheck (lookup path)', () => {
    expect(getOxygenInteractionActions(failedSnapshot(['recheck']))).toEqual([
      'recheck',
      'dismiss',
    ]);
  });

  it('offers submit + dismiss for failed-with-resubmit', () => {
    expect(getOxygenInteractionActions(failedSnapshot(['resubmit']))).toEqual([
      'submit',
      'dismiss',
    ]);
  });

  it('offers recheck, submit, then dismiss when both recoveries are present', () => {
    expect(
      getOxygenInteractionActions(failedSnapshot(['recheck', 'resubmit']))
    ).toEqual(['recheck', 'submit', 'dismiss']);
    expect(
      getOxygenInteractionActions(failedSnapshot(['resubmit', 'recheck']))
    ).toEqual(['recheck', 'submit', 'dismiss']);
  });

  it('dedupes and drops unknown recoveries', () => {
    expect(
      getOxygenInteractionActions(
        failedSnapshot([
          'recheck',
          'recheck',
          'handover' as OxygenFailedRecovery,
        ])
      )
    ).toEqual(['recheck', 'dismiss']);
  });

  it('tolerates a missing recoveries list and unknown states', () => {
    expect(
      getOxygenInteractionActions({
        state: 'failed',
      } as OxygenInteractionSnapshot)
    ).toEqual(['dismiss']);
    expect(
      getOxygenInteractionActions({
        state: FIXTURE_ORDER_ID as OxygenInteractionState,
        recoveries: [],
      })
    ).toEqual([]);
  });

  it('pins the button labels', () => {
    const labels: Record<OxygenInteractionAction, string> =
      OXYGEN_INTERACTION_ACTION_LABELS;
    expect(labels).toEqual({
      signin: 'Sign in',
      recheck: 'Check again',
      submit: 'Continue with Oxygen',
      dismiss: 'Dismiss',
    });
  });
});

describe('mapOxygenLookupResult — 200 outcomes', () => {
  it.each([
    'checking',
    'resuming',
  ] as const)('maps 200 available to ready from %s', (from) => {
    const transition = mapOxygenLookupResult(lookupOk(true), from);
    expect(transition.snapshot).toEqual({
      state: 'ready',
      recoveries: [],
    });
    expect(transition.logHostError).toBe(false);
  });

  it('consumes the marker on resume-complete, keeps it on a fresh check', () => {
    expect(
      mapOxygenLookupResult(lookupOk(true), 'resuming').clearOrderMarker
    ).toBe(true);
    expect(
      mapOxygenLookupResult(lookupOk(true), 'checking').clearOrderMarker
    ).toBe(false);
  });

  it.each(
    SIX_REASONS.filter((reason) => reason !== 'oxygen_guest_not_allowed')
  )('maps 200 deny (%s) to unavailable with the reason kept', (reason) => {
    for (const from of ['checking', 'resuming'] as const) {
      const transition = mapOxygenLookupResult(lookupOk(false, reason), from);
      expect(transition.snapshot).toEqual({
        state: 'unavailable',
        reason,
        recoveries: [],
      });
      expect(transition.clearOrderMarker).toBe(false);
      expect(transition.logHostError).toBe(false);
    }
  });

  it('maps the guest deny to signin-required regardless of the local session', () => {
    for (const from of ['checking', 'resuming'] as const) {
      const transition = mapOxygenLookupResult(
        lookupOk(false, 'oxygen_guest_not_allowed'),
        from
      );
      expect(transition.snapshot).toEqual({
        state: 'signin-required',
        reason: 'oxygen_guest_not_allowed',
        recoveries: [],
      });
      expect(transition.clearOrderMarker).toBe(false);
    }
  });

  it('fails a deny with a missing reason closed to retryable failure', () => {
    for (const from of ['checking', 'resuming'] as const) {
      const transition = mapOxygenLookupResult(lookupOk(false), from);
      expect(transition.snapshot).toEqual(failedSnapshot(['recheck']));
      expect(transition.clearOrderMarker).toBe(false);
    }
  });

  it('fails a deny with an unknown reason closed to retryable failure', () => {
    for (const from of ['checking', 'resuming'] as const) {
      const transition = mapOxygenLookupResult(
        lookupOk(false, FIXTURE_ORDER_ID),
        from
      );
      expect(transition.snapshot).toEqual(failedSnapshot(['recheck']));
      expect(transition.clearOrderMarker).toBe(false);
    }
  });

  it('fails a deny with a non-string reason closed to retryable failure', () => {
    const transition = mapOxygenLookupResult(
      { ok: true, available: false, reason: 42 as unknown as string },
      'checking'
    );
    expect(transition.snapshot).toEqual(failedSnapshot(['recheck']));
  });

  it('requires a strict available flag; truthy garbage denies closed', () => {
    const transition = mapOxygenLookupResult(
      { ok: true, available: 'yes' as unknown as boolean },
      'checking'
    );
    expect(transition.snapshot).toEqual(failedSnapshot(['recheck']));
  });
});

describe('mapOxygenLookupResult — error statuses', () => {
  it.each([
    'checking',
    'resuming',
  ] as const)('maps 404 to idle + discard from %s (access lost)', (from) => {
    const transition = mapOxygenLookupResult(lookupErr(404), from);
    expect(transition.snapshot).toEqual(idleInteractionSnapshot());
    expect(transition.clearOrderMarker).toBe(true);
    expect(transition.logHostError).toBe(false);
  });

  it.each([
    'checking',
    'resuming',
  ] as const)('maps 401 to reason-less signin-required with the marker kept from %s', (from) => {
    const transition = mapOxygenLookupResult(lookupErr(401), from);
    expect(transition.snapshot).toEqual({
      state: 'signin-required',
      recoveries: [],
    });
    expect(transition.clearOrderMarker).toBe(false);
  });

  it.each([
    'checking',
    'resuming',
  ] as const)('maps 400 to failed-with-no-recovery + host-error flag from %s', (from) => {
    const transition = mapOxygenLookupResult(lookupErr(400), from);
    expect(transition.snapshot).toEqual(failedSnapshot([]));
    expect(transition.logHostError).toBe(true);
    expect(transition.clearOrderMarker).toBe(false);
  });

  it.each([
    429, 500, 502, 503,
  ])('maps %s to failed-with-recheck (marker kept)', (status) => {
    for (const from of ['checking', 'resuming'] as const) {
      const transition = mapOxygenLookupResult(lookupErr(status), from);
      expect(transition.snapshot).toEqual(failedSnapshot(['recheck']));
      expect(transition.clearOrderMarker).toBe(false);
      expect(transition.logHostError).toBe(false);
    }
  });

  it('maps a CSRF-shaped 403 (no code) to failed-with-recheck', () => {
    for (const from of ['checking', 'resuming'] as const) {
      expect(mapOxygenLookupResult(lookupErr(403), from).snapshot).toEqual(
        failedSnapshot(['recheck'])
      );
    }
  });

  it('maps even a coded 403 on GET to failed-with-recheck (GET denies are 200)', () => {
    const transition = mapOxygenLookupResult(
      lookupErr(403, 'oxygen_rollout_disabled'),
      'checking'
    );
    expect(transition.snapshot).toEqual(failedSnapshot(['recheck']));
  });

  it('maps unknown statuses closed to failed-with-recheck', () => {
    expect(mapOxygenLookupResult(lookupErr(418), 'checking').snapshot).toEqual(
      failedSnapshot(['recheck'])
    );
  });

  it('maps a network failure to failed-with-recheck, never a discard', () => {
    for (const from of ['checking', 'resuming'] as const) {
      const transition = mapOxygenLookupNetworkFailure(from);
      expect(transition.snapshot).toEqual(failedSnapshot(['recheck']));
      expect(transition.clearOrderMarker).toBe(false);
      expect(transition.logHostError).toBe(false);
    }
  });
});

describe('mapOxygenSubmitResult', () => {
  it('maps 2xx to handed-off with the handoff flag (payload ignored)', () => {
    const transition = mapOxygenSubmitResult({ ok: true });
    expect(transition.snapshot).toEqual({
      state: 'handed-off',
      recoveries: [],
    });
    expect(transition.handoff).toBe(true);
    expect(transition.clearOrderMarker).toBe(false);
    expect(transition.logHostError).toBe(false);
  });

  it.each(
    SIX_REASONS
  )('maps a coded 403 (%s) to unavailable with the reason', (reason) => {
    const transition = mapOxygenSubmitResult(submitErr(403, reason));
    expect(transition.snapshot).toEqual({
      state: 'unavailable',
      reason,
      recoveries: [],
    });
    expect(transition.handoff).toBe(false);
    expect(transition.clearOrderMarker).toBe(false);
  });

  it('maps a codeless 403 (CSRF shape) to failed-with-both, never unavailable', () => {
    const transition = mapOxygenSubmitResult(submitErr(403));
    expect(transition.snapshot).toEqual(
      failedSnapshot(['recheck', 'resubmit'])
    );
    expect(transition.handoff).toBe(false);
  });

  it('maps an empty-string code like a missing code', () => {
    expect(mapOxygenSubmitResult(submitErr(403, '')).snapshot).toEqual(
      failedSnapshot(['recheck', 'resubmit'])
    );
  });

  it('maps an unknown 403 code closed to failed-with-both', () => {
    const transition = mapOxygenSubmitResult(
      submitErr(403, 'oxygen_provider_unavailable')
    );
    expect(transition.snapshot).toEqual(
      failedSnapshot(['recheck', 'resubmit'])
    );
  });

  it('maps a non-string 403 code closed to failed-with-both', () => {
    const transition = mapOxygenSubmitResult({
      ok: false,
      status: 403,
      code: 403 as unknown as string,
    });
    expect(transition.snapshot).toEqual(
      failedSnapshot(['recheck', 'resubmit'])
    );
  });

  it('maps 404 to idle + discard (access lost)', () => {
    const transition = mapOxygenSubmitResult(submitErr(404));
    expect(transition.snapshot).toEqual(idleInteractionSnapshot());
    expect(transition.clearOrderMarker).toBe(true);
    expect(transition.handoff).toBe(false);
  });

  it('maps 401 to reason-less signin-required with the marker kept', () => {
    const transition = mapOxygenSubmitResult(submitErr(401));
    expect(transition.snapshot).toEqual({
      state: 'signin-required',
      recoveries: [],
    });
    expect(transition.clearOrderMarker).toBe(false);
    expect(transition.handoff).toBe(false);
  });

  it('maps 400 to failed-with-no-recovery + host-error flag', () => {
    const transition = mapOxygenSubmitResult(submitErr(400));
    expect(transition.snapshot).toEqual(failedSnapshot([]));
    expect(transition.logHostError).toBe(true);
    expect(transition.handoff).toBe(false);
  });

  it.each([
    429, 500, 502, 503,
  ])('maps %s to failed-with-both (resubmit stays offered)', (status) => {
    const transition = mapOxygenSubmitResult(submitErr(status));
    expect(transition.snapshot).toEqual(
      failedSnapshot(['recheck', 'resubmit'])
    );
    expect(transition.handoff).toBe(false);
    expect(transition.logHostError).toBe(false);
  });

  it('maps unknown statuses closed to failed-with-both', () => {
    expect(mapOxygenSubmitResult(submitErr(418)).snapshot).toEqual(
      failedSnapshot(['recheck', 'resubmit'])
    );
  });

  it('maps a network failure to failed-with-both', () => {
    const transition = mapOxygenSubmitNetworkFailure();
    expect(transition.snapshot).toEqual(
      failedSnapshot(['recheck', 'resubmit'])
    );
    expect(transition.handoff).toBe(false);
    expect(transition.clearOrderMarker).toBe(false);
    expect(transition.logHostError).toBe(false);
  });
});

describe('snapshotForRevalidate and applyOxygenDismiss', () => {
  it('revalidates to resuming with a marker, checking without', () => {
    expect(snapshotForRevalidate(true)).toEqual({
      state: 'resuming',
      recoveries: [],
    });
    expect(snapshotForRevalidate(false)).toEqual({
      state: 'checking',
      recoveries: [],
    });
  });

  it('ignores dismiss while initiating (no dismiss, marker untouched)', () => {
    const snapshot: OxygenInteractionSnapshot = {
      state: 'initiating',
      recoveries: [],
    };
    const transition = applyOxygenDismiss(snapshot);
    expect(transition.ignored).toBe(true);
    expect(transition.snapshot).toBe(snapshot);
    expect(transition.clearOrderMarker).toBe(false);
  });

  it('ignores dismiss while idle without clearing markers', () => {
    const snapshot = idleInteractionSnapshot();
    const transition = applyOxygenDismiss(snapshot);
    expect(transition.ignored).toBe(true);
    expect(transition.snapshot).toBe(snapshot);
    expect(transition.clearOrderMarker).toBe(false);
  });

  it.each([
    'checking',
    'ready',
    'unavailable',
    'signin-required',
    'handed-off',
    'resuming',
    'failed',
  ] as OxygenInteractionState[])('dismisses %s to idle + clear', (state) => {
    const transition = applyOxygenDismiss({
      state,
      reason: 'oxygen_rollout_disabled',
      recoveries: ['recheck', 'resubmit'],
    });
    expect(transition.ignored).toBe(false);
    expect(transition.snapshot).toEqual(idleInteractionSnapshot());
    expect(transition.clearOrderMarker).toBe(true);
  });
});

describe('handoff marker', () => {
  const NOW = 1_760_000_000_000;

  it('pins the per-order key shape and the 24h TTL', () => {
    expect(OXYGEN_HANDOFF_MARKER_PREFIX).toBe('baci_oxygen_handoff:');
    expect(OXYGEN_HANDOFF_MARKER_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(oxygenHandoffMarkerKey(FIXTURE_ORDER_ID)).toBe(
      `baci_oxygen_handoff:${FIXTURE_ORDER_ID}`
    );
  });

  it('round-trips a written marker with orderId + createdAt only', () => {
    const storage = new FakeMarkerStorage();
    writeOxygenHandoffMarker(storage, FIXTURE_ORDER_ID, NOW);
    expect(readOxygenHandoffMarker(storage, FIXTURE_ORDER_ID, NOW)).toEqual({
      orderId: FIXTURE_ORDER_ID,
      createdAt: NOW,
    });
    expect(
      Object.keys(
        JSON.parse(
          storage.getItem(oxygenHandoffMarkerKey(FIXTURE_ORDER_ID)) ?? '{}'
        )
      ).sort()
    ).toEqual(['createdAt', 'orderId']);
  });

  it('returns null when no marker is stored', () => {
    expect(
      readOxygenHandoffMarker(new FakeMarkerStorage(), FIXTURE_ORDER_ID, NOW)
    ).toBeNull();
  });

  it('last-write-wins for same-order writes (multi-tab)', () => {
    const storage = new FakeMarkerStorage();
    writeOxygenHandoffMarker(storage, FIXTURE_ORDER_ID, NOW - 1000);
    writeOxygenHandoffMarker(storage, FIXTURE_ORDER_ID, NOW);
    expect(readOxygenHandoffMarker(storage, FIXTURE_ORDER_ID, NOW)).toEqual({
      orderId: FIXTURE_ORDER_ID,
      createdAt: NOW,
    });
  });

  it('discards corrupt JSON (null + key removed)', () => {
    const storage = new FakeMarkerStorage();
    storage.setItem(oxygenHandoffMarkerKey(FIXTURE_ORDER_ID), '{nope');
    expect(readOxygenHandoffMarker(storage, FIXTURE_ORDER_ID, NOW)).toBeNull();
    expect(
      storage.getItem(oxygenHandoffMarkerKey(FIXTURE_ORDER_ID))
    ).toBeNull();
  });

  it('discards an order-key mismatch (null + key removed)', () => {
    const storage = new FakeMarkerStorage();
    storage.setItem(
      oxygenHandoffMarkerKey(FIXTURE_ORDER_ID),
      JSON.stringify({ orderId: 'another-order', createdAt: NOW })
    );
    expect(readOxygenHandoffMarker(storage, FIXTURE_ORDER_ID, NOW)).toBeNull();
    expect(
      storage.getItem(oxygenHandoffMarkerKey(FIXTURE_ORDER_ID))
    ).toBeNull();
  });

  it('discards a non-object payload (null + key removed)', () => {
    const storage = new FakeMarkerStorage();
    storage.setItem(
      oxygenHandoffMarkerKey(FIXTURE_ORDER_ID),
      JSON.stringify(['orderId', NOW])
    );
    expect(readOxygenHandoffMarker(storage, FIXTURE_ORDER_ID, NOW)).toBeNull();
    expect(
      storage.getItem(oxygenHandoffMarkerKey(FIXTURE_ORDER_ID))
    ).toBeNull();
  });

  it('discards a non-numeric createdAt (null + key removed)', () => {
    const storage = new FakeMarkerStorage();
    for (const createdAt of ['yesterday', Number.NaN, null, {}]) {
      storage.setItem(
        oxygenHandoffMarkerKey(FIXTURE_ORDER_ID),
        JSON.stringify({ orderId: FIXTURE_ORDER_ID, createdAt })
      );
      expect(
        readOxygenHandoffMarker(storage, FIXTURE_ORDER_ID, NOW)
      ).toBeNull();
      expect(
        storage.getItem(oxygenHandoffMarkerKey(FIXTURE_ORDER_ID))
      ).toBeNull();
    }
  });

  it('discards an expired marker past the 24h TTL', () => {
    const storage = new FakeMarkerStorage();
    storage.setItem(
      oxygenHandoffMarkerKey(FIXTURE_ORDER_ID),
      JSON.stringify({
        orderId: FIXTURE_ORDER_ID,
        createdAt: NOW - OXYGEN_HANDOFF_MARKER_TTL_MS - 1,
      })
    );
    expect(readOxygenHandoffMarker(storage, FIXTURE_ORDER_ID, NOW)).toBeNull();
    expect(
      storage.getItem(oxygenHandoffMarkerKey(FIXTURE_ORDER_ID))
    ).toBeNull();
  });

  it('keeps a marker exactly at the TTL boundary', () => {
    const storage = new FakeMarkerStorage();
    const createdAt = NOW - OXYGEN_HANDOFF_MARKER_TTL_MS;
    writeOxygenHandoffMarker(storage, FIXTURE_ORDER_ID, createdAt);
    expect(readOxygenHandoffMarker(storage, FIXTURE_ORDER_ID, NOW)).toEqual({
      orderId: FIXTURE_ORDER_ID,
      createdAt,
    });
  });

  it('accepts a future createdAt (clock skew fails open to revalidation)', () => {
    const storage = new FakeMarkerStorage();
    writeOxygenHandoffMarker(storage, FIXTURE_ORDER_ID, NOW + 60_000);
    expect(readOxygenHandoffMarker(storage, FIXTURE_ORDER_ID, NOW)).toEqual({
      orderId: FIXTURE_ORDER_ID,
      createdAt: NOW + 60_000,
    });
  });

  it('clears a single order marker without touching siblings', () => {
    const storage = new FakeMarkerStorage();
    writeOxygenHandoffMarker(storage, FIXTURE_ORDER_ID, NOW);
    writeOxygenHandoffMarker(storage, 'sibling-order', NOW);
    clearOxygenHandoffMarker(storage, FIXTURE_ORDER_ID);
    expect(
      storage.getItem(oxygenHandoffMarkerKey(FIXTURE_ORDER_ID))
    ).toBeNull();
    expect(
      storage.getItem(oxygenHandoffMarkerKey('sibling-order'))
    ).not.toBeNull();
  });

  it('prefix-clears every handoff marker and leaves foreign keys alone', () => {
    const storage = new FakeMarkerStorage();
    writeOxygenHandoffMarker(storage, FIXTURE_ORDER_ID, NOW);
    writeOxygenHandoffMarker(storage, 'sibling-order', NOW);
    storage.setItem('storefront-checkout-idempotency', 'keep-me');
    clearAllOxygenHandoffMarkers(storage);
    expect(storage.keys()).toEqual(['storefront-checkout-idempotency']);
  });

  it('ignores blank order ids for every marker op', () => {
    const storage = new FakeMarkerStorage();
    writeOxygenHandoffMarker(storage, '', NOW);
    expect(storage.keys()).toEqual([]);
    expect(readOxygenHandoffMarker(storage, '', NOW)).toBeNull();
    expect(() => clearOxygenHandoffMarker(storage, '')).not.toThrow();
  });

  it('treats null storage as absent markers everywhere without throwing', () => {
    expect(() =>
      writeOxygenHandoffMarker(null, FIXTURE_ORDER_ID, NOW)
    ).not.toThrow();
    expect(readOxygenHandoffMarker(null, FIXTURE_ORDER_ID, NOW)).toBeNull();
    expect(() =>
      clearOxygenHandoffMarker(null, FIXTURE_ORDER_ID)
    ).not.toThrow();
    expect(() => clearAllOxygenHandoffMarkers(null)).not.toThrow();
  });

  it('survives throwing storage without breaking the flow', () => {
    const throwing: OxygenMarkerStorage = {
      get length(): number {
        throw new Error('denied');
      },
      key: () => {
        throw new Error('denied');
      },
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(() =>
      writeOxygenHandoffMarker(throwing, FIXTURE_ORDER_ID, NOW)
    ).not.toThrow();
    expect(readOxygenHandoffMarker(throwing, FIXTURE_ORDER_ID, NOW)).toBeNull();
    expect(() =>
      clearOxygenHandoffMarker(throwing, FIXTURE_ORDER_ID)
    ).not.toThrow();
    expect(() => clearAllOxygenHandoffMarkers(throwing)).not.toThrow();
  });

  it('prefix-clear tolerates unreadable slots and unremovable keys', () => {
    const flaky: OxygenMarkerStorage = {
      get length(): number {
        return 2;
      },
      key: (index: number) => {
        if (index === 0) throw new Error('unreadable slot');
        return `${OXYGEN_HANDOFF_MARKER_PREFIX}stuck`;
      },
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {
        throw new Error('locked');
      },
    };
    expect(() => clearAllOxygenHandoffMarkers(flaky)).not.toThrow();
  });
});

describe('generateOxygenNonce', () => {
  it('produces UUID-shaped nonces', () => {
    const uuidV4 =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    for (let i = 0; i < 5; i += 1) {
      expect(generateOxygenNonce()).toMatch(uuidV4);
    }
  });

  it('produces unique nonces (never asserts header semantics)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      seen.add(generateOxygenNonce());
    }
    expect(seen.size).toBe(100);
  });
});

describe('toChatMessageText', () => {
  it.each(S04_MESSAGE_TABLE)('returns the S-04 message for a known $reason', ({
    reason,
    message,
  }) => {
    expect(toChatMessageText({ status: 'unavailable', reason })).toBe(message);
  });

  it('returns the status default when the reason is omitted', () => {
    expect(toChatMessageText({ status: 'ready' })).toBe(
      'Oxygen is available for this order.'
    );
    expect(toChatMessageText({ status: 'failed' })).toBe(
      'Something went wrong.'
    );
  });

  it('falls back for an unknown status, never echoing the input', () => {
    expect(toChatMessageText({ status: FIXTURE_ORDER_ID })).toBe(
      'Something went wrong.'
    );
    expect(
      toChatMessageText({
        status: FIXTURE_ORDER_ID,
        reason: 'oxygen_rollout_disabled',
      })
    ).toBe('Something went wrong.');
    expect(toChatMessageText({ status: 'interrupted' })).toBe(
      'Something went wrong.'
    );
  });

  it('falls back for an unknown reason, never echoing the input', () => {
    expect(
      toChatMessageText({ status: 'failed', reason: FIXTURE_ORDER_ID })
    ).toBe('Something went wrong.');
    expect(toChatMessageText({ status: 'failed', reason: FIXTURE_EMAIL })).toBe(
      'Something went wrong.'
    );
  });

  it('falls back for non-string inputs', () => {
    expect(toChatMessageText({ status: null })).toBe('Something went wrong.');
    expect(toChatMessageText({ status: 42 })).toBe('Something went wrong.');
    expect(toChatMessageText({ status: 'ready', reason: { id: 1 } })).toBe(
      'Something went wrong.'
    );
  });
});

describe('toAnalyticsEvent', () => {
  it('builds the captureClientEvent-shaped payload for known inputs', () => {
    expect(
      toAnalyticsEvent({
        status: 'unavailable',
        reason: 'oxygen_rollout_disabled',
      })
    ).toEqual({
      event: 'oxygen_interaction',
      properties: {
        status: 'unavailable',
        reason: 'oxygen_rollout_disabled',
      },
    });
  });

  it('omits the reason key when no reason is given', () => {
    expect(toAnalyticsEvent({ status: 'ready' })).toEqual({
      event: 'oxygen_interaction',
      properties: { status: 'ready' },
    });
  });

  it.each(ALL_STATES)('accepts the machine state %s', (status) => {
    expect(toAnalyticsEvent({ status })?.properties.status).toBe(status);
  });

  it('returns null for an unknown status (host skips)', () => {
    expect(toAnalyticsEvent({ status: FIXTURE_ORDER_ID })).toBeNull();
    expect(
      toAnalyticsEvent({
        status: FIXTURE_ORDER_ID,
        reason: 'oxygen_rollout_disabled',
      })
    ).toBeNull();
    expect(toAnalyticsEvent({ status: null })).toBeNull();
  });

  it('drops an unknown reason instead of emitting it', () => {
    expect(
      toAnalyticsEvent({ status: 'failed', reason: FIXTURE_ORDER_ID })
    ).toEqual({
      event: 'oxygen_interaction',
      properties: { status: 'failed' },
    });
    expect(
      toAnalyticsEvent({ status: 'failed', reason: FIXTURE_EMAIL })
    ).toEqual({
      event: 'oxygen_interaction',
      properties: { status: 'failed' },
    });
  });

  it('stays passable to the real captureClientEvent sink', () => {
    const built = toAnalyticsEvent({ status: 'ready' });
    expect(built).not.toBeNull();
    if (built === null) return;
    // The call below is the contract: built values must satisfy the real
    // sink signature, so drift on either side fails tsc on this file.
    // (The no-telemetry-import rule constrains the source module, not tests;
    // the sink queues pre-init and never throws, so the call is safe here.)
    captureClientEvent(built.event, built.properties);
    expect(built.event).toBe('oxygen_interaction');
    expect(built.properties.status).toBe('ready');
  });

  it('sweeps every builder output for fixture ids, emails, and free text', () => {
    const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
    const reasons: Array<OxygenInteractionReason | undefined> = [
      ...SIX_REASONS,
      undefined,
    ];
    for (const status of ALL_STATES) {
      for (const reason of reasons) {
        const built = toAnalyticsEvent({ status, reason });
        expect(built).not.toBeNull();
        const serialized = JSON.stringify(built);
        expect(serialized).not.toContain(FIXTURE_ORDER_ID);
        expect(serialized).not.toContain(FIXTURE_EMAIL);
        expect(serialized).not.toMatch(emailPattern);
        expect(toChatMessageText({ status, reason })).not.toContain(
          FIXTURE_ORDER_ID
        );
      }
    }
  });

  it('uses only telemetry-safe property keys (client-config PII token rules)', () => {
    const sensitiveTokens = new Set([
      'password',
      'passcode',
      'token',
      'secret',
      'authorization',
      'cookie',
      'otp',
      'pin',
      'cvv',
      'card',
      'bvn',
      'nin',
      'email',
      'phone',
      'address',
    ]);
    const tokenize = (key: string): string[] =>
      key
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .toLowerCase()
        .split(/[^a-z0-9]+/);
    for (const status of ALL_STATES) {
      const built = toAnalyticsEvent({
        status,
        reason: 'oxygen_guest_not_allowed',
      });
      expect(built).not.toBeNull();
      for (const key of Object.keys(built?.properties ?? {})) {
        for (const token of tokenize(key)) {
          expect(sensitiveTokens.has(token)).toBe(false);
        }
      }
      const serialized = JSON.stringify(built?.properties);
      expect(serialized).not.toContain('order-fixture');
      expect(serialized).not.toContain('@');
    }
  });
});

describe('D-05 sweep over builder outputs', () => {
  it('keeps every copy output free of credit-decision language', () => {
    const outputs: string[] = [OXYGEN_INTERACTION_FALLBACK_COPY];
    const chatOutputs: string[] = [];
    for (const state of ALL_STATES) {
      outputs.push(getOxygenInteractionCopy(state));
      const chatText = toChatMessageText({ status: state });
      outputs.push(chatText);
      chatOutputs.push(chatText);
      for (const reason of SIX_REASONS) {
        outputs.push(getOxygenInteractionCopy(state, reason));
        const reasonChatText = toChatMessageText({ status: state, reason });
        outputs.push(reasonChatText);
        chatOutputs.push(reasonChatText);
      }
    }
    // The sweep must vary by state: identical chat outputs would prove the
    // loop variable never reaches the builder (e.g. an ambient global read).
    expect(new Set(chatOutputs).size).toBeGreaterThan(1);
    outputs.push(...Object.values(OXYGEN_INTERACTION_ACTION_LABELS));
    outputs.push(...Object.values(OXYGEN_INTERACTION_REASON_COPY));
    for (const output of outputs) {
      for (const phrase of FORBIDDEN_PHRASES) {
        expect(output.toLowerCase()).not.toContain(phrase);
      }
    }
  });
});

describe('interaction module shape (static)', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/lib/payments/oxygen/interaction.ts'),
    'utf8'
  );

  it('imports nothing: framework-agnostic core', () => {
    expect(source).not.toMatch(/^import /m);
    expect(source).not.toContain('require(');
  });

  it('touches no React, provider, storage, network, or telemetry surface', () => {
    expect(source).not.toContain('React');
    expect(source).not.toContain('transport');
    expect(source).not.toContain('token-cache');
    expect(source).not.toContain('sessionStorage');
    expect(source).not.toContain('localStorage');
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('XMLHttpRequest');
    expect(source).not.toContain('posthog');
    expect(source).not.toContain('captureClientEvent');
    expect(source).not.toContain('console');
    expect(source).not.toContain('process.env');
    expect(source).not.toContain('typeof window');
    expect(source).not.toContain('window.sessionStorage');
    expect(source).not.toContain('window.localStorage');
  });

  it('keeps approval language out of the module', () => {
    for (const phrase of FORBIDDEN_PHRASES) {
      expect(source.toLowerCase()).not.toContain(phrase);
    }
  });
});
