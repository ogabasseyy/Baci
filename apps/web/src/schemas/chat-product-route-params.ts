import { z } from 'zod';
import {
  evaluateStorefrontSlugSafety,
  MAX_SAFE_STOREFRONT_SLUG_ENCODED_LENGTH,
  MAX_SLUG_DECODE_PASSES,
} from '@/lib/storefront-slug-safety';

const merchantSlug = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/);

const ENCODED_PATH_SEPARATOR_OR_CONTROL =
  /%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f|c2%(?:8[0-9a-f]|9[0-9a-f]))/i;

function hasEncodedPathSeparatorOrControl(value: string): boolean {
  let candidate = value;
  for (
    let pass = 0;
    pass < MAX_SAFE_STOREFRONT_SLUG_ENCODED_LENGTH;
    pass += 1
  ) {
    if (ENCODED_PATH_SEPARATOR_OR_CONTROL.test(candidate)) return true;
    const decodedPercent = candidate.replace(/%25/gi, '%');
    if (decodedPercent === candidate) return false;
    candidate = decodedPercent;
  }
  return ENCODED_PATH_SEPARATOR_OR_CONTROL.test(candidate);
}

function isSafeProductRouteSegment(value: string): boolean {
  if (!evaluateStorefrontSlugSafety(value).safe) return false;

  let candidate = value;
  for (let pass = 0; pass <= MAX_SLUG_DECODE_PASSES; pass += 1) {
    if (
      candidate === '.' ||
      candidate === '..' ||
      /[/\\\p{Cc}]/u.test(candidate)
    ) {
      return false;
    }

    try {
      const decoded = decodeURIComponent(candidate);
      if (decoded === candidate) return true;
      candidate = decoded;
    } catch {
      // Preserve ordinary literal percent characters, but do not let malformed
      // escapes hide encoded separators or control bytes from the path check.
      return !hasEncodedPathSeparatorOrControl(candidate);
    }
  }

  // The shared safety guard rejects values that remain encoded beyond its
  // decode budget. This branch is only reachable for an already-bounded safe value.
  return true;
}

const productSlug = z
  .string()
  .min(1)
  .max(200)
  .refine(isSafeProductRouteSegment);
export const chatProductRouteParamsSchema = z
  .object({ slug: merchantSlug, productSlug })
  .strict();
