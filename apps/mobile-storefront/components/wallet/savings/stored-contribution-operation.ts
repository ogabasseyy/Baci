import { checkPiggyvestPrimarySavingsStatus } from '@/lib/piggyvest-primary-savings-status';

export function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const { code } = error as { code?: unknown };
  return typeof code === 'string' ? code : undefined;
}

/**
 * Returns the stored primary operation id if it can still be resubmitted, or
 * null when the server cancelled it or has no record of it (resubmitting a
 * cancelled id answers 'conflict' forever). Ambiguous failures keep the id so
 * a retry cannot double-spend.
 */
export async function reusableStoredOperationId(input: {
  merchantId?: string;
  operationId: string | null | undefined;
  isPrimary: boolean;
}): Promise<string | null> {
  if (!input.operationId) return null;
  if (!input.isPrimary) return input.operationId;
  try {
    const result = await checkPiggyvestPrimarySavingsStatus({
      merchantId: input.merchantId,
      operationId: input.operationId,
    });
    return result.status === 'cancelled' ? null : input.operationId;
  } catch (error) {
    return getErrorCode(error) === 'CONTRIBUTION_NOT_FOUND'
      ? null
      : input.operationId;
  }
}
