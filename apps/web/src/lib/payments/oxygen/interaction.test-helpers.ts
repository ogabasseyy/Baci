import type {
  OxygenFailedRecovery,
  OxygenInteractionReason,
  OxygenInteractionSnapshot,
  OxygenInteractionState,
  OxygenLookupResult,
  OxygenMarkerStorage,
  OxygenSubmitResult,
} from './interaction';

// S-04 §403 message table, copied verbatim from the design doc. The reason
// strings are the specified API (same treatment as reason codes).
export const S04_MESSAGE_TABLE: Array<{
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

export const ALL_STATES: OxygenInteractionState[] = [
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

export const SIX_REASONS: OxygenInteractionReason[] = [
  'oxygen_identity_mismatch',
  'oxygen_environment_mismatch',
  'oxygen_guest_not_allowed',
  'oxygen_not_configured',
  'oxygen_rollout_disabled',
  'oxygen_provider_unverified',
];

// D-05 sweep list: availability wording only, never credit-decision wording.
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

export const FIXTURE_ORDER_ID =
  'order-fixture-9f2c4b7a-0000-4000-8000-aaaaaaaaaaaa';
export const FIXTURE_EMAIL = 'shell-fixture@example.com';

export function failedSnapshot(
  recoveries: OxygenFailedRecovery[]
): OxygenInteractionSnapshot {
  return { state: 'failed', recoveries };
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
