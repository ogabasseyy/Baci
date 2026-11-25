import { z } from 'zod';

const chatwootBankScopeSchema = z.object({
  conversationId: z.number().int().positive().safe(),
  sessionToken: z.string().min(1).max(12_000),
});

export const chatwootBankVerificationRequestSchema = z.discriminatedUnion(
  'action',
  [
    chatwootBankScopeSchema.extend({
      action: z.literal('banks'),
    }),
    chatwootBankScopeSchema.extend({
      action: z.literal('resolve'),
      bankCode: z.string().trim().min(1).max(32),
      accountNumber: z.string().regex(/^\d{10}$/),
      phone: z.string().trim().min(10).max(20),
    }),
  ]
);

export type ChatwootBankVerificationRequest = z.infer<
  typeof chatwootBankVerificationRequestSchema
>;

export const chatwootBankBridgeCommandSchema = z.discriminatedUnion('action', [
  chatwootBankScopeSchema.extend({
    action: z.literal('banks'),
    requestId: z.string().uuid(),
  }),
  chatwootBankScopeSchema.extend({
    action: z.literal('resolve'),
    requestId: z.string().uuid(),
    bankCode: z.string().trim().min(1).max(32),
    accountNumber: z.string().regex(/^\d{10}$/),
    phone: z.string().trim().min(10).max(20),
  }),
]);
