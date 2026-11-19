import { crossRemListingBindingsSchema } from '@/schemas/crossrem-listing-binding';
import ogabasseyBindings from './ogabassey-listing-bindings.json';

export const CROSSREM_MERCHANT_ID = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

// The versioned baseline preserves exact sellable identities. Keep retired IDs
// reserved by marking the old binding retired.
export const CROSSREM_CATALOG_BINDINGS =
  crossRemListingBindingsSchema.parse(ogabasseyBindings);
