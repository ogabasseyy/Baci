import { z } from 'zod';
export const cartSessionRecordSchema = z.object({
  proof: z
    .string()
    .regex(/^cp1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    .max(8192),
  ownerSubject: z.uuid().optional(),
  retired: z.boolean().optional(),
  promotion: z
    .object({
      kind: z.enum(['create', 'handoff', 'account']),
      operationId: z.string().min(1).max(128),
      cartId: z.uuid(),
      fromActor: z.string().min(1).max(128).optional(),
      ownerSubject: z.uuid().optional(),
    })
    .optional(),
});
