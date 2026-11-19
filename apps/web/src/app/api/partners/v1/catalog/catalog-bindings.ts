import { crossRemListingBindingsSchema } from '@/schemas/crossrem-listing-binding';
import ogabasseyBindings from './ogabassey-listing-bindings.json';

// The versioned baseline preserves exact sellable identities. Keep retired IDs
// reserved by marking the old binding retired.
export const crossRemCatalogConfig = {
  merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  bindings: crossRemListingBindingsSchema.parse(ogabasseyBindings),
} as const;
