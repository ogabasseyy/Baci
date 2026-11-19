import { z } from 'zod';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const experiencePublicObservation = z.strictObject({
  parentBuild: digest,
  frameBuild: digest,
  scriptDigest: digest,
  styleDigest: digest,
  routes: z
    .array(
      z.strictObject({
        path: z.string().min(1).max(240),
        title: z.string().min(1).max(500),
        canonical: z.url(),
        status: z.literal(200),
      })
    )
    .min(1)
    .max(128),
  journey: z.strictObject({
    steps: z
      .array(
        z.strictObject({
          action: z.enum([
            'navigate',
            'product',
            'cart-add',
            'cart-read',
            'checkout-review',
          ]),
          path: z.string().min(1).max(240),
          evidenceDigest: digest,
        })
      )
      .min(1)
      .max(32),
    orderRequests: z.literal(0),
    paymentRequests: z.literal(0),
  }),
  assets: z.record(z.string(), digest),
  evidenceDigest: digest,
});
