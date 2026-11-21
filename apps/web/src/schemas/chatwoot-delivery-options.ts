import { z } from 'zod';
import { isMajorAmountRepresentable } from '@/lib/money/is-major-amount-representable';

export const chatwootDeliveryOptionsRequestSchema = z
  .object({
    sessionToken: z.string().min(1).max(12_000),
    conversationId: z.number().int().positive().safe(),
    expectedCartVersion: z.number().int().nonnegative().safe(),
    state: z.string().trim().min(2).max(100),
  })
  .strict();

const deliveryOptionSchema = z
  .object({
    displayName: z.string().min(1).max(120),
    priceMajor: z.number().finite().nonnegative(),
    currency: z.literal('NGN'),
    estimatedDays: z.number().int().min(0).max(365).optional(),
    pickup: z.boolean(),
    pickupLocation: z.string().min(1).max(240).optional(),
    pickupInstructions: z.string().min(1).max(240).optional(),
  })
  .strict()
  .superRefine((option, context) => {
    if (!isMajorAmountRepresentable(option.priceMajor, option.currency)) {
      context.addIssue({
        code: 'custom',
        message: 'Price has precision smaller than the currency minor unit',
        path: ['priceMajor'],
      });
    }
  });

export const chatwootDeliveryOptionsResponseSchema = z
  .object({
    state: z.string().min(2).max(100),
    cartVersion: z.number().int().nonnegative().safe(),
    currency: z.literal('NGN'),
    subtotalMinor: z.number().int().nonnegative().safe(),
    options: z.array(deliveryOptionSchema).min(1).max(20),
  })
  .strict();

export type ChatwootDeliveryOptionsRequest = z.infer<
  typeof chatwootDeliveryOptionsRequestSchema
>;
export type ChatwootDeliveryOptionsResponse = z.infer<
  typeof chatwootDeliveryOptionsResponseSchema
>;
