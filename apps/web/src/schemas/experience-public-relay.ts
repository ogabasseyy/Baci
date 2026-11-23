import { z } from 'zod';
import { MAX_PUBLIC_CART_SESSION_REQUESTS } from '../../tools/experience-runner/public-observation-resource-limit';
import { publicCartRelayBuildDigest } from './experience-public-cart-relay';

const merchantSlug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/);
const productId = z.uuid();

export const experiencePublicRelayIdentitySchema = z.object({
  merchantId: z.uuid(),
  merchantSlug,
  productId,
  variantId: z.uuid().optional(),
});

export const experiencePublicRelayProductSchema =
  experiencePublicRelayIdentitySchema.pick({
    merchantId: true,
    productId: true,
  });

export const experiencePublicRelayRequestLimitSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_PUBLIC_CART_SESSION_REQUESTS);

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
