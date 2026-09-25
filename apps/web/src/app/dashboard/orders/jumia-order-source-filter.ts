export const JUMIA_ORDER_SOURCE_FILTER = 'jumia' as const;

/**
 * Parses the dashboard `source` query param for the Jumia order view
 * linked from per-integration "View orders" links.
 */
export function parseJumiaOrderSourceFilter(
  value: string | string[] | null | undefined
): typeof JUMIA_ORDER_SOURCE_FILTER | undefined {
  const source = Array.isArray(value) ? value[0] : value;
  if (
    typeof source === 'string' &&
    source.trim().toLowerCase() === JUMIA_ORDER_SOURCE_FILTER
  ) {
    return JUMIA_ORDER_SOURCE_FILTER;
  }
  return undefined;
}
