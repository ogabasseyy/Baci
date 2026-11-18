import { z } from 'zod';

const nullableStringField = z
  .string()
  .nullable()
  .optional()
  .transform((value) => value ?? '');

export const customerSessionUserSchema = z
  .object({
    id: z.string().min(1),
    email: nullableStringField,
    role: nullableStringField.transform((value) => value || 'customer'),
  })
  .passthrough();

export const customerSessionCustomerSchema = z
  .object({
    id: z.string().min(1),
    first_name: nullableStringField,
    last_name: nullableStringField,
    email: nullableStringField,
  })
  .passthrough();

export const customerSessionResponseSchema = z.object({
  authenticated: z.boolean().optional(),
  user: customerSessionUserSchema.nullable().optional(),
  customer: customerSessionCustomerSchema.nullable().optional(),
});
