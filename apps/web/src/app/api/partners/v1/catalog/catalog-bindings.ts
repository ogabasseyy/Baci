import { logger } from '@/lib/logger';
import { crossRemListingBindingsSchema } from '@/schemas/crossrem-listing-binding';
import ogabasseyBindings from './ogabassey-listing-bindings.json';

const parsedBindings =
  crossRemListingBindingsSchema.safeParse(ogabasseyBindings);
if (!parsedBindings.success) {
  const { issues } = parsedBindings.error;
  logger.warn({
    message: 'CrossRem catalog bindings failed validation',
    issueCount: issues.length,
    issues: issues.slice(0, 5).map(({ code, path }) => ({
      code,
      path: path.join('.'),
    })),
  });
}

// The versioned baseline preserves exact sellable identities. Keep retired IDs
// reserved by marking the old binding retired.
export const crossRemCatalogConfig = {
  merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  // Treat invalid data as unconfigured so the route can emit its 503 alert.
  bindings: parsedBindings.data ?? [],
} as const;
