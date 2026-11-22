import { z } from 'zod';
import {
  MAX_PUBLIC_OBSERVATION_RESOURCES,
  MAX_PUBLIC_OBSERVATION_ROUTES,
  MAX_PUBLIC_RESOURCE_BYTES,
} from '../../tools/experience-runner/public-observation-resource-limit';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const publicObservationRoute = z.object({
  path: z.string().max(240),
  title: z.string().min(1).max(500),
  canonical: z.url(),
});
export const publicObservationPayload = z.object({
  version: z.literal(1),
  origin: z.string(),
  product: z.object({
    origin: z.string(),
    merchantId: z.uuid(),
    productId: z.uuid(),
    variantId: z.uuid().optional(),
  }),
  expected: z.object({
    buildDigest: digest,
    scriptDigest: digest,
    styleDigest: digest,
    assets: z.record(z.string(), digest),
    routes: z
      .array(publicObservationRoute)
      .min(1)
      .max(MAX_PUBLIC_OBSERVATION_ROUTES),
    product: z.object({
      id: z.uuid(),
      path: z.string().max(240),
      native: z.literal(true).optional(),
      variantId: z.uuid().optional(),
    }),
  }),
  resources: z
    .array(
      z.object({
        url: z.url(),
        mime: z.string().max(128),
        bytes: z.string().max(4 * Math.ceil(MAX_PUBLIC_RESOURCE_BYTES / 3)),
        headers: z.record(z.string(), z.string()),
      })
    )
    .min(1)
    .max(MAX_PUBLIC_OBSERVATION_RESOURCES),
});

export const publicObservationStartFrame = z.strictObject({
  type: z.literal('start'),
  payload: z.unknown(),
});
