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
 * of the original attempt and a retry never crosses rails (the rails dedupe
 * independently, so crossing would debit twice).
 * - legacy rail (or an id with no recorded rail, which only legacy goal
 *   creation mints): keep it; it is resubmitted on legacy only.
 * - primary rail: the status endpoint is authoritative. Confirmed completes,
 *   cancelled or CONTRIBUTION_NOT_FOUND releases the id, pending keeps it, and
 *   any ambiguous error blocks (unknown) while keeping the id.
 */
export async function resolveStoredOperation(input: {
  merchantId?: string;
  operationId: string | null | undefined;
  rail: ContributionRail | null | undefined;
}): Promise<StoredOperationState> {
  if (!input.operationId) {
    return { operationId: null, rail: null, confirmed: false };
  }
  if (input.rail !== 'primary') {
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
    if (getErrorCode(error) === 'CONTRIBUTION_NOT_FOUND') return released;
    return { ...keep, unknown: true };
  }
}
