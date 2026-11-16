import { z } from 'zod';

export const customerSessionUserSchema = z
  .object({
    id: z.string().min(1),
    email: z.string().default(''),
    role: z.string().default('customer'),
  })
  .passthrough();

export const customerSessionCustomerSchema = z
  .object({
    id: z.string().min(1),
    first_name: z.string().default(''),
    last_name: z.string().default(''),
    email: z.string().default(''),
  })
  .passthrough();

export const customerSessionResponseSchema = z.object({
  authenticated: z.boolean().optional(),
  user: customerSessionUserSchema.nullable().optional(),
  customer: customerSessionCustomerSchema.nullable().optional(),
});
