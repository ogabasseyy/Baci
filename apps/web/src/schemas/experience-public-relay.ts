import { z } from 'zod';
import { publicCartRelayBuildDigest } from './experience-public-cart-relay';

const merchantSlug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/);
const productId = z.uuid();

export const experiencePublicRelayIdentitySchema = z.object({
  merchantId: z.uuid(),
  merchantSlug,
  productId,
  variantId: z.uuid().optional(),
});

export const experiencePublicRelayCatalogSchema = z.object({
  merchantSlug,
  productId,
  productSlug: z.string().regex(/^[a-z0-9-]{1,240}$/),
});

export const experiencePublicRelayStateSchema = z.object({
  slug: merchantSlug,
  buildDigest: publicCartRelayBuildDigest,
  policyRevision: z.string().min(1).max(128),
});
