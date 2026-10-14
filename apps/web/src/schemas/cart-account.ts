import { z } from 'zod';
export const cartRevokeRequestSchema = z.strictObject({});

export const verifiedCartCustomerRowSchema = z.object({
  id: z.uuid(),
  merchant_id: z.uuid(),
  user_id: z.uuid(),
});

import { cartInputLineSchema, cartItemIdentitySchema } from './cart';
export const cartAccountLinkRequestSchema = z
  .strictObject({
    operationId: z.string().trim().min(1).max(96),
    choice: z.enum(['keep_current', 'use_saved', 'merge']),
    expectedSavedCartId: z.uuid().nullable().optional(),
    expectedSavedVersion: z.number().int().min(1).optional(),
    expectedCurrentVersion: z.number().int().min(1).optional(),
    lines: z.array(cartInputLineSchema).max(20).optional(),
    resolutions: z
      .array(
        z.strictObject({
          item: cartItemIdentitySchema,
          keep: z.enum(['incoming', 'existing']),
        })
      )
      .max(20)
      .optional(),
  })
  .superRefine((value, context) => {
    if (value.choice !== 'merge') return;
    for (const key of [
      'lines',
      'expectedSavedVersion',
      'expectedCurrentVersion',
      'expectedSavedCartId',
    ] as const)
      if (value[key] === undefined || value[key] === null)
        context.addIssue({
          code: 'custom',
          path: [key],
          message: 'Review both carts before merging',
        });
  });
export type CartAccountLinkInput = z.infer<typeof cartAccountLinkRequestSchema>;
export const cartAccountLinkReceiptSchema = z.object({
  ok: z.literal(true),
  cartId: z.uuid(),
  grantId: z.uuid(),
  principalId: z.string().min(1).max(128),
  replayed: z.boolean().optional(),
});
