import { buildProductSearchQuery } from '@baci/shared/lib';

/**
 * Zod-free storefront validator for search assistance query bounds.
 * Mirrors `searchAssistanceQuerySchema` (trimmed 2-120 chars, normalized catalog term).
 */
export function isValidSearchAssistanceQuery(query: unknown): boolean {
  if (typeof query !== 'string') return false;
  const trimmed = query.trim();
  return (
    trimmed.length >= 2 &&
    trimmed.length <= 120 &&
    Boolean(buildProductSearchQuery(trimmed).normalized)
  );
}
