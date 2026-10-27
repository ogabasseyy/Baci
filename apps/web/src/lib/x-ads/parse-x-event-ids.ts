import type { XEventIds } from '@/schemas/x-ads-settings';

/**
 * Zod-free equivalent of `xEventIdsSchema.safeParse` for client bundles.
 *
 * The analytics provider and X pixel client are mounted on every storefront
 * page; importing zod there ships ~76 KB (br) in each page's initial `<head>`
 * JS, which Lighthouse charges to simulated LCP. Server/API code keeps using
 * the zod schema; `parse-x-event-ids.test.ts` asserts both stay equivalent.
 */
export const X_EVENT_ID_KEYS = [
  'pageView',
  'viewContent',
  'addToCart',
  'initiateCheckout',
  'purchase',
  'search',
  'signUp',
  'addToWishlist',
] as const satisfies readonly (keyof XEventIds)[];

const X_EVENT_CODE_PATTERN = /^tw-[A-Za-z0-9]{1,64}-[A-Za-z0-9]{1,128}$/;
const ALLOWED_KEYS = new Set<string>(X_EVENT_ID_KEYS);

export function parseXEventIds(value: unknown): XEventIds | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const parsed: XEventIds = {};
  for (const key of Object.keys(record)) {
    if (!ALLOWED_KEYS.has(key)) return null;
    const raw = record[key];
    if (raw === undefined) continue;
    if (typeof raw !== 'string') return null;
    const code = raw.trim();
    if (!X_EVENT_CODE_PATTERN.test(code)) return null;
    parsed[key as keyof XEventIds] = code;
  }
  return parsed;
}
