/** PostgREST's no-row result is a valid public category fallback. */
export function isPostgrestNoRowsError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    Object.hasOwn(error, 'code') &&
    Reflect.get(error, 'code') === 'PGRST116'
  );
}
