import { z } from 'zod';

export const runtimeCompositionCsrfSchemas = {
  goalId: z.uuid().transform((value) => value.toLowerCase()),
  cookiePath: z.string().regex(/^\/(?:scenario\/[1-9][0-9]{0,5})?$/),
  secret: z
    .instanceof(Uint8Array)
    .refine((value) => value.byteLength === 32 && new Set(value).size >= 16),
  token: z.string().regex(/^[0-9a-f]{32}\.[0-9]{13}\.[A-Za-z0-9_-]{43}$/),
  bootstrap: z.strictObject({
    csrfToken: z.string().min(1).max(128),
    expiresAt: z.number().int().positive(),
  }),
};
