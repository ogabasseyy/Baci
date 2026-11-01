import { z } from 'zod';
export const mediaDeletionIdentitySchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[a-zA-Z0-9._-]+$/)
  .refine((value) => !value.includes('..'));
