import type { z } from 'zod';
import { publishedExperienceSchema } from '@/schemas/experience-published';
import { validateExperienceRoutes } from './route-ownership';
import { getExperienceStorefrontRuntime } from './storefront-runtime';
export type PublishedManifest = z.infer<typeof publishedExperienceSchema>;
export function parsePublishedExperience(value: unknown): PublishedManifest {
  const parsed = publishedExperienceSchema.parse(value);
  return { ...parsed, routes: validateExperienceRoutes(parsed.routes) };
}
/** No runtime is installed until the later startup/publication checkpoint. */
export async function loadPublishedExperience(merchant: {
  id: string;
  slug?: string | null;
}): Promise<PublishedManifest | null> {
  const runtime = getExperienceStorefrontRuntime();
  if (!runtime) return null;
  const value = await runtime.loadPublishedManifest(merchant);
  if (!value) return null;
  const parsed = parsePublishedExperience(value);
  if (parsed.merchantId !== merchant.id) throw Error('MERCHANT_MISMATCH');
  return parsed;
}
