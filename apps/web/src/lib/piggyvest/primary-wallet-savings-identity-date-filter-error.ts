export function isExplicitUnsupportedSavingsDateFilterError(
  error: unknown
): boolean {
  if (!(error instanceof Error) || error.message !== 'PROVIDER_HTTP_ERROR')
    return false;
  const { httpStatus, responseBody } = error as Error & {
    httpStatus?: unknown;
    responseBody?: unknown;
  };
  if (httpStatus !== 400 && httpStatus !== 422) return false;
  if (!responseBody || typeof responseBody !== 'object') return false;

  const body = responseBody as Record<string, unknown>;
  const detail = [body.message, body.error, body.detail, body.code]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();
  return (
    /\b(start_date|end_date|date filter|date range)\b/.test(detail) &&
    /\b(unsupported|not supported|unknown|unrecognized|not recognized|not allowed|invalid (?:query )?parameter)\b/.test(
      detail
    )
  );
}
