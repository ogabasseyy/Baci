import { checkPiggyvestPrimarySavingsStatus } from '@/lib/piggyvest-primary-savings-status';

export function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const { code } = error as { code?: unknown };
  return typeof code === 'string' ? code : undefined;
}

export type StoredOperationState = {
  /** Id to submit with; null means mint a fresh one. */
  operationId: string | null;
  /** PiggyVest already confirmed it: complete without submitting again. */
  confirmed: boolean;
};

/**
 * Resolves what to do with a stored primary operation id. Only an
 * authoritative cancellation releases it (resubmitting a cancelled id answers
 * 'conflict' forever). Absence from primary storage does NOT: the legacy
 * fallback rail may hold the debit under the same id and dedupes by it.
 * Ambiguous failures keep the id so a retry cannot double-spend.
 */
export async function resolveStoredOperation(input: {
  merchantId?: string;
  operationId: string | null | undefined;
  isPrimary: boolean;
}): Promise<StoredOperationState> {
  const keep = { operationId: input.operationId ?? null, confirmed: false };
  if (!input.operationId || !input.isPrimary) return keep;
  try {
    const result = await checkPiggyvestPrimarySavingsStatus({
      merchantId: input.merchantId,
      operationId: input.operationId,
    });
    if (result.status === 'cancelled') {
      return { operationId: null, confirmed: false };
    }
    return { ...keep, confirmed: result.status === 'confirmed' };
  } catch {
    return keep;
  }
}
