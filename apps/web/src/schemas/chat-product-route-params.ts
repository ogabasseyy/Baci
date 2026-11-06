import { z } from 'zod';
import { evaluateStorefrontSlugSafety } from '@/lib/storefront-slug-safety';

const merchantSlug = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/);

function isSafeProductRouteSegment(value: string): boolean {
  if (!evaluateStorefrontSlugSafety(value).safe) return false;

  let candidate = value;
  for (let pass = 0; pass <= 3; pass += 1) {
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
      return !/%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f|8[0-9a-f]|9[0-9a-f])/i.test(
        candidate
      );
    }
  }

  // The shared safety guard rejects values that remain encoded beyond three
  // passes; this branch is only reachable for an already-bounded safe value.
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
