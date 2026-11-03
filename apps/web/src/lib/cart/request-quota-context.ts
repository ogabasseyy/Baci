// Provisional deadlines must be qualified against staging before release.
const AVAILABLE_QUOTA_DEADLINE_MS = 750;
const REQUIRED_QUOTA_DEADLINE_MS = 1500;

export interface CartQuotaRequestContext {
  remainingMs: number;
  degraded: boolean;
}

/** Shared by all quota checks in one HTTP request. */
export function createCartQuotaRequestContext(
  mode: 'available' | 'required'
): CartQuotaRequestContext {
  return {
    remainingMs:
      mode === 'available'
        ? AVAILABLE_QUOTA_DEADLINE_MS
        : REQUIRED_QUOTA_DEADLINE_MS,
    degraded: false,
  };
}
