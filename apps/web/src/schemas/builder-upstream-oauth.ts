import { z } from 'zod';

export const upstreamAuthorizationId = z.uuid();

export const upstreamAuthorizationDecision = z.object({
  authorizationId: upstreamAuthorizationId,
  decision: z.enum(['approve', 'deny']),
});

export const upstreamAuthorizationConsent = z.object({
  authorization_id: upstreamAuthorizationId,
  redirect_uri: z.url(),
  client: z.object({ id: z.uuid() }),
  user: z.object({ id: z.uuid() }),
  scope: z.literal('openid'),
});

export const upstreamApprovedRedirect = z.strictObject({
  redirect_url: z.string().max(8192).url(),
});
