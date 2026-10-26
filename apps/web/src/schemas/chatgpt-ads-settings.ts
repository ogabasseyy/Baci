import { z } from 'zod';
export const chatgptAdsSettingsSchema = z
  .strictObject({
    pixelId: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{1,128}$/)
      .nullable(),
    capiKey: z.string().trim().max(4096).optional(),
    disconnect: z.boolean().default(false),
  })
  .superRefine((input, ctx) => {
    if (!input.disconnect && !input.pixelId)
      ctx.addIssue({
        code: 'custom',
        path: ['pixelId'],
        message: 'Enter a Pixel ID.',
      });
  });

export const chatgptAdsConnectionSchema = z.strictObject({
  pixelId: z.string().nullable(),
  capiConfigured: z.boolean(),
});
export type ChatgptAdsConnection = z.infer<typeof chatgptAdsConnectionSchema>;
