import { z } from 'zod';

export const oxygenSessionSchema = z
  .object({
    email: z.email().max(254),
    password: z.string().min(1).max(256),
  })
  .strict();
