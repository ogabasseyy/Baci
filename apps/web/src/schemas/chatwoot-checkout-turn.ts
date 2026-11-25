import { z } from 'zod';

export const chatwootCheckoutTurnStepSchema = z.enum([
  'device_protection',
  'payment_mode',
  'delivery_address',
  'same_as_home',
  'email',
  'phone',
  'confirm_payment',
  'check_transfer',
  'select_bank',
  'account_number',
  'confirm_account',
  'employment_status',
  'employer_name',
  'salary_amount',
  'salary_day',
  'oxygen_consent',
]);

export const chatwootCheckoutTurnOptionSchema = z.object({
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(150),
});

export const chatwootCheckoutTurnRequestSchema = z.object({
  conversationId: z.number().int().positive().safe(),
  sessionToken: z.string().min(1).max(12_000),
  step: chatwootCheckoutTurnStepSchema,
  question: z.string().trim().min(1).max(300),
  answer: z.string().trim().min(1).max(300),
  options: z.array(chatwootCheckoutTurnOptionSchema).max(200).optional(),
});

export const chatwootCheckoutTurnBridgeCommandSchema =
  chatwootCheckoutTurnRequestSchema.extend({
    requestId: z.string().uuid(),
  });

export const chatwootCheckoutTurnModelOutputSchema = z.object({
  intent: z.enum([
    'confirm',
    'reject',
    'select_option',
    'side_question',
    'unclear',
  ]),
  selectedCode: z.string().nullable().optional().catch(null),
  extractedValue: z.string().nullable().optional().catch(null),
  reply: z.string().nullable().optional().catch(null),
});

export type ChatwootCheckoutTurnStep = z.infer<
  typeof chatwootCheckoutTurnStepSchema
>;
export type ChatwootCheckoutTurnRequest = z.infer<
  typeof chatwootCheckoutTurnRequestSchema
>;
