import { z } from 'zod';

const item = z.object({
  productId: z.uuid(),
  variantId: z.uuid().optional(),
  condition: z.enum(['new', 'used', 'open_box', 'refurbished']).optional(),
  options: z.record(z.string(), z.string()).optional(),
});
const attachments = {
  voucherToken: z.string().optional(),
  voucherAwardId: z.string().optional(),
  negotiatedUnitPriceMinor: z.number().int().nonnegative().optional(),
  negotiationStatus: z.enum(['pending', 'accepted', 'rejected']).optional(),
};
const line = z.object({
  item,
  quantity: z.number().int().min(1).max(10),
  ...attachments,
});
const operationId = z.string().min(1).max(128);
const command = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('add'),
    item,
    quantity: z.number().int().min(1).max(10),
    ...attachments,
  }),
  z.object({
    type: z.literal('set_quantity'),
    lineId: z.string().min(1),
    quantity: z.number().int().min(1).max(10),
  }),
  z.object({ type: z.literal('remove'), lineId: z.string().min(1) }),
  z.object({
    type: z.literal('set_assurance'),
    lineId: z.string().min(1),
    hasAssurance: z.boolean(),
  }),
  z.object({
    type: z.literal('set_negotiated_price'),
    lineId: z.string().min(1),
    negotiatedUnitPriceMinor: z.number().int().min(1).nullable(),
  }),
  z.object({ type: z.literal('clear') }),
  z.object({ type: z.literal('replace'), lines: z.array(line).max(20) }),
]);
export const nativeHandoffRedeemSchema = z
  .object({
    token: z.string().regex(/^ch1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/),
    handoffId: z.uuid(),
    attemptId: operationId,
    choice: z.enum(['connect', 'merge', 'keep_existing']),
    destCartId: z.uuid().optional(),
    expectedIncomingVersion: z.number().int().min(1).optional(),
    expectedDestVersion: z.number().int().min(1).optional(),
    lines: z.array(line).max(20).optional(),
    resolutions: z
      .array(z.object({ item, keep: z.enum(['incoming', 'existing']) }))
      .max(20)
      .optional(),
  })
  .superRefine((value, context) => {
    if (value.choice !== 'merge') return;
    for (const key of [
      'lines',
      'destCartId',
      'expectedIncomingVersion',
      'expectedDestVersion',
    ] as const)
      if (value[key] === undefined)
        context.addIssue({
          code: 'custom',
          path: [key],
          message: 'A complete reviewed merge is required',
        });
  });
const accountLink = z.object({
  operationId,
  choice: z.enum(['keep_current', 'use_saved', 'merge']),
  expectedSavedCartId: z.uuid().nullable().optional(),
  expectedSavedVersion: z.number().int().min(1).optional(),
  expectedCurrentVersion: z.number().int().min(1).optional(),
  lines: z.array(line).max(20).optional(),
  resolutions: z
    .array(z.object({ item, keep: z.enum(['incoming', 'existing']) }))
    .max(20)
    .optional(),
});
export const pendingCartBodySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('account'),
    ownerSubject: z.uuid(),
    input: accountLink,
  }),
  z.object({ kind: z.literal('handoff'), input: nativeHandoffRedeemSchema }),
  z.object({
    kind: z.literal('create'),
    input: z.object({
      operationId,
      lines: z.array(line).max(20).optional(),
      currency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .optional(),
    }),
  }),
  z.object({
    kind: z.literal('command'),
    cartId: z.uuid(),
    input: z.object({
      operationId,
      expectedVersion: z.number().int().min(1),
      command,
    }),
  }),
]);
export type PendingCartBody = z.infer<typeof pendingCartBodySchema>;
