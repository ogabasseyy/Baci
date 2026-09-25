/**
 * Jumia Vendor Center API — Auth schemas
 */

import { z } from 'zod';

/**
 * Accepts a number or a numeric string (digits only), rejects booleans/arrays.
 * Preserves `.int().positive()` semantics after conversion.
 */
const numericOrString = z
  .union([z.number(), z.string().regex(/^\d+$/)])
  .transform(Number)
  .pipe(z.int().positive());

// Token ceilings keep every schema-valid response inside the 32,768-char
// credential-ciphertext storage: the worst case (8,192-char tokens with a
// 512-char client id) encrypts to ~30.2k chars, so oversized provider
// responses fail validation instead of persistence after rotation.
export const JumiaTokenResponseSchema = z.object({
  access_token: z.string().trim().min(1).max(8192),
  expires_in: numericOrString,
  refresh_token: z.string().trim().min(1).max(8192).optional(),
  refresh_expires_in: numericOrString.optional(),
  token_type: z.string().trim().min(1),
});

export const JumiaSelfAuthorizationTokenResponseSchema =
  JumiaTokenResponseSchema.extend({
    refresh_token: z.string().trim().min(1).max(8192),
    refresh_expires_in: numericOrString,
  });

export const JumiaTokenErrorSchema = z.object({
  error: z.string().trim().min(1),
  error_description: z.string().trim().min(1),
});

export type JumiaTokenResponse = z.infer<typeof JumiaTokenResponseSchema>;
export type JumiaSelfAuthorizationTokenResponse = z.infer<
  typeof JumiaSelfAuthorizationTokenResponseSchema
>;
export type JumiaTokenError = z.infer<typeof JumiaTokenErrorSchema>;
