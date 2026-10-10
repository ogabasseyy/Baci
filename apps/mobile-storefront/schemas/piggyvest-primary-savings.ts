import { z } from 'zod';

export const PiggyvestPrimarySavingsSchemas = {
  recoveryRequest: z
    .object({ merchantId: z.uuid(), goalId: z.uuid() })
    .strict(),
  recoveryResponse: z
    .object({
      operation: z
        .object({
          operationId: z.uuid(),
          goalId: z.uuid(),
          amountKobo: z.number().int().positive().max(9999999999),
          state: z.enum(['reserved', 'dispatched']),
        })
        .strict()
        .nullable(),
    })
    .strict(),
  statusRequest: z
    .object({ merchantId: z.uuid(), operationId: z.uuid() })
    .strict(),
  statusResponse: z
    .object({
      status: z.enum(['pending', 'confirmed', 'cancelled']),
      operationId: z.uuid(),
    })
    .strict(),
  request: z
    .object({
      merchantId: z.uuid(),
      goalId: z.uuid(),
      operationId: z.uuid(),
      amountKobo: z.number().int().positive().max(9999999999),
    })
    .strict(),
  response: z
    .object({
      status: z.enum(['pending', 'confirmed', 'cancelled']),
      operationId: z.uuid(),
    })
    .strict(),
};
