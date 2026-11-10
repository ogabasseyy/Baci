/** Never log Error objects/messages: database and provider failures may carry
 * credentials or raw payloads. SQLSTATE is the only bounded diagnostic field. */
export function captureFailureDetail(
  error: unknown,
  phase: 'process' | 'settle' | 'renew'
): { phase: typeof phase; sqlState?: string } {
  if (
    typeof error === 'object' &&
    error !== null &&
    'sqlState' in error &&
    typeof error.sqlState === 'string' &&
    /^[0-9A-Z]{5}$/.test(error.sqlState)
  )
    return { phase, sqlState: error.sqlState };
  return { phase };
}
