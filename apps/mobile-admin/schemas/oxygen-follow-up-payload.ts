import { z } from 'zod';

export function extractBoundedArray(
  payload: unknown,
  maxItems: number
): { items: unknown[]; isBoundedValid: boolean } {
  const parsed = z.array(z.unknown()).max(maxItems).safeParse(payload);
  if (parsed.success) {
    return { items: parsed.data, isBoundedValid: true };
  }
  return {
    items: Array.isArray(payload) ? payload.slice(0, maxItems) : [],
    isBoundedValid: false,
  };
}
