import { z } from 'zod';
import { mcpGuestCartOutputSchema } from './mcp-guest-cart';

export const guestOAuthResourceUrlSchema = z.string().url().max(2048);

export const guestOAuthAuthorizationSchema = z.object({
  client_id: z.string().min(1).max(256),
  redirect_uri: z.string().url().max(2048),
  resource: guestOAuthResourceUrlSchema,
  scope: z.literal('cart:write'),
  response_type: z.literal('code'),
  code_challenge_method: z.literal('S256'),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  state: z.string().max(2048).optional(),
});
export const guestOAuthExchangeSchema = guestOAuthAuthorizationSchema
  .pick({ client_id: true, redirect_uri: true, resource: true })
  .extend({
    code: z.string().regex(/^[a-f0-9]{64}$/),
    code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
  });
export const guestOAuthRefreshSchema = z.object({
  client_id: z.string().min(1).max(256),
  resource: guestOAuthResourceUrlSchema,
  refresh_token: z.string().regex(/^(?:[a-f0-9]{64}|[a-f0-9]{104})$/),
  scope: z.literal('cart:write').optional(),
});
export const guestOAuthGrantSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string(),
  resource: z.string(),
  expiresAt: z.number(),
  revoked: z.boolean(),
  refreshHash: z.string(),
  refreshSigningKey: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  tokenGenerations: z.number().int().min(0).max(1024).default(0),
  cartToken: z.string().regex(/^[a-f0-9]{64}$/),
  cartInitialized: z.boolean(),
});

export const guestOAuthCartInputSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.number().int().min(0).max(10).default(1),
  expectedVersion: z.number().int().min(1).optional(),
  operationId: z.string().trim().min(1).max(128).optional(),
});

export const guestOAuthCartOutputSchema = z
  .object(mcpGuestCartOutputSchema.shape)
  .omit({ cart_token: true })
  .extend({ connection_bound: z.literal(true) })
  .refine(
    (value) =>
      !value.success ||
      (value.items !== undefined &&
        value.expires_at !== undefined &&
        value.cart_url !== undefined),
    {
      message: 'Successful connected-cart output must include handoff fields',
    }
  );

export const guestOAuthTokenRecordSchema = z.object({
  grantId: z.string().uuid(),
  expiresAt: z.number(),
});
export const guestOAuthAccessRecordSchema = guestOAuthTokenRecordSchema.extend({
  generation: z.string(),
});
export const guestOAuthCodeRecordSchema = z.object({
  request: guestOAuthAuthorizationSchema,
  used: z.boolean(),
});
export const guestOAuthConsentRecordSchema = guestOAuthCodeRecordSchema.extend({
  cookieHash: z.string(),
});

export const guestOAuthCipherRecordSchema = z
  .array(
    z.object({
      ciphertext: z.string(),
      revision: z.number().int().positive(),
      expires_at: z.string().datetime({ offset: true }),
    })
  )
  .max(1);
export const guestOAuthWorkerClaimsSchema = z.object({
  role: z.literal('mcp_guest_oauth_worker'),
  merchant_id: z.string().uuid(),
  exp: z.number(),
});
export const guestOAuthWorkerHeaderSchema = z.object({
  alg: z.enum(['ES256', 'RS256', 'HS256']),
});
export const guestOAuthRedirectListSchema = z
  .array(z.string().url())
  .min(1)
  .max(4);
export const guestOAuthRegistrationSchema = z.object({
  redirect_uris: z.array(z.string().url()).length(1),
  token_endpoint_auth_method: z.literal('none').default('none'),
  grant_types: z
    .array(z.enum(['authorization_code', 'refresh_token']))
    .min(1)
    .optional(),
  response_types: z.array(z.literal('code')).min(1).optional(),
});

export const guestOAuthReadCartInputSchema = z.object({});

export const guestOAuthConsentQuotaSchema = z.object({
  count: z.number().int().min(0).max(600),
});
