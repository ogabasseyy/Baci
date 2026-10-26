import { z } from 'zod';

const pixel = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9]{1,64}$/);
const code = z
  .string()
  .trim()
  .regex(/^tw-[A-Za-z0-9]{1,64}-[A-Za-z0-9]{1,128}$/);
export const xEventIdsSchema = z.strictObject({
  pageView: code.optional(),
  viewContent: code.optional(),
  addToCart: code.optional(),
  initiateCheckout: code.optional(),
  purchase: code.optional(),
  search: code.optional(),
  signUp: code.optional(),
  addToWishlist: code.optional(),
});
export type XEventIds = z.infer<typeof xEventIdsSchema>;
export const xAdsCredentialsSchema = z.strictObject({
  consumerKey: z.string().trim().min(1).max(4096),
  consumerSecret: z.string().trim().min(1).max(4096),
  accessToken: z.string().trim().min(1).max(4096),
  accessTokenSecret: z.string().trim().min(1).max(4096),
});
export type XAdsCredentials = z.infer<typeof xAdsCredentialsSchema>;
export const xAdsSettingsSchema = z
  .strictObject({
    pixelId: pixel.nullable(),
    eventIds: xEventIdsSchema.default({}),
    credentials: xAdsCredentialsSchema.optional(),
    disconnect: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (!value.disconnect && !value.pixelId)
      ctx.addIssue({
        code: 'custom',
        path: ['pixelId'],
        message: 'Enter the Pixel ID.',
      });
    for (const [key, id] of Object.entries(value.eventIds))
      if (value.pixelId && !id.startsWith(`tw-${value.pixelId}-`))
        ctx.addIssue({
          code: 'custom',
          path: ['eventIds', key],
          message: 'Use an event code from this Pixel.',
        });
  });
export const xAdsConnectionSchema = z.strictObject({
  pixelId: z.string().nullable(),
  eventIds: xEventIdsSchema,
  capiConfigured: z.boolean(),
});
export type XAdsConnection = z.infer<typeof xAdsConnectionSchema>;
