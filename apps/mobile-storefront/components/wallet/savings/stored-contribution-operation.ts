import { checkPiggyvestPrimarySavingsStatus } from '@/lib/piggyvest-primary-savings-status';

export function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const { code } = error as { code?: unknown };
  return typeof code === 'string' ? code : undefined;
}

export type ContributionRail = 'primary' | 'legacy';

export type StoredOperationState = {
  /** Id to submit with; null means mint a fresh one. */
  operationId: string | null;
  /** Rail the stored id belongs to; null when no id is kept. */
  rail: ContributionRail | null;
  /** PiggyVest already confirmed it: complete without submitting again. */
  confirmed: boolean;
  /** The status lookup failed ambiguously: do not submit anything yet. */
  unknown?: boolean;
};

/**
 * Resolves what to do with a stored operation id. The id is bound to the rail
 * of the original attempt (written before the network call) and a retry never
 * crosses rails (the rails dedupe independently, so crossing would debit
 * twice).
 * - legacy rail: keep it; it is resubmitted on legacy only.
 * - primary rail: the status endpoint is authoritative. Confirmed completes,
 *   cancelled or CONTRIBUTION_NOT_FOUND releases the id, pending keeps it, and
 *   any ambiguous error blocks (unknown) while keeping the id.
 * - unrecorded rail (older stored id): unknown, never assumed legacy. Ask
 *   primary first: confirmed or pending means it is a primary id; not found
 *   (or SAVINGS_MERCHANT_NOT_PRIMARY, a merchant that cannot hold a primary
 *   record) means it can only be legacy (resubmit there, same id); cancelled releases
 *   it; an ambiguous error blocks and keeps the id.
 */
export async function resolveStoredOperation(input: {
  merchantId?: string;
  operationId: string | null | undefined;
  rail: ContributionRail | null | undefined;
}): Promise<StoredOperationState> {
  if (!input.operationId) {
    return { operationId: null, rail: null, confirmed: false };
  }
  if (input.rail === 'legacy') {
    return { operationId: input.operationId, rail: 'legacy', confirmed: false };
  }
  const keep = {
    operationId: input.operationId,
    rail: 'primary' as const,
    confirmed: false,
  };
  const released = { operationId: null, rail: null, confirmed: false };
  try {
    const result = await checkPiggyvestPrimarySavingsStatus({
      merchantId: input.merchantId,
      operationId: input.operationId,
    });
    if (result.status === 'cancelled') return released;
    return { ...keep, confirmed: result.status === 'confirmed' };
  } catch (error) {
    const code = getErrorCode(error);
    if (code === 'CONTRIBUTION_NOT_FOUND') {
      // Recorded primary: primary has no record, release. Unrecorded: only
      // the legacy rail can hold it, so keep the id and resubmit there.
      return input.rail === 'primary'
        ? released
        : { operationId: input.operationId, rail: 'legacy', confirmed: false };
    }
    if (code === 'SAVINGS_MERCHANT_NOT_PRIMARY') {
      // Derived from runtime config, not the provider record: a stale binding
      // must never release a recorded primary id. An unrecorded id predates
      // the stored rail (primary was dark then), so it can only be legacy.
      return input.rail === 'primary'
        ? { ...keep, unknown: true }
        : { operationId: input.operationId, rail: 'legacy', confirmed: false };
    }
    return { ...keep, unknown: true };
  }
}
