import { z } from 'zod';

export const repairPickupSchemas = {
  error: z.object({ error: z.string() }),
  quote: z.object({ price: z.number().positive(), currency: z.literal('NGN') }),
  payment: z.discriminatedUnion('success', [
    z.object({
      success: z.literal(true),
      ticketNumber: z.number().int().positive(),
      resumeToken: z.string(),
      payment: z.object({
        amount: z.number().positive(),
        authorizationUrl: z.url(),
        reference: z.string(),
      }),
    }),
    z.object({
      success: z.literal(false),
      error: z.string(),
      code: z.string(),
      resumeToken: z.string().optional(),
      ticketNumber: z.number().int().positive().optional(),
      quote: z.object({ price: z.number().positive() }).optional(),
    }),
  ]),
  status: z.discriminatedUnion('found', [
    z.object({ found: z.literal(false) }),
    z.object({
      found: z.literal(true),
      repair: z.object({
        status: z.string(),
        trackingNumber: z.string().nullable(),
        pickupPaymentStatus: z
          .enum([
            'awaiting_payment',
            'paid',
            'booking',
            'booked',
            'retrying',
            'review',
            'manual_fulfilled',
          ])
          .nullable(),
        ticketNumber: z.number().int().positive(),
      }),
    }),
  ]),
  session: z.object({
    resumeToken: z.string(),
    ticketNumber: z.number().int().positive().optional(),
    paymentUrl: z.url().optional(),
    price: z.number().positive(),
  }),
};

export type RepairPickupSession = z.infer<typeof repairPickupSchemas.session>;
