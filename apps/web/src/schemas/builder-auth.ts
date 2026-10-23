import { z } from 'zod';
export const builderScopes = [
  'storefront.read',
  'storefront.write',
  'storefront.publish',
] as const;
export const builderConnectionSchema = z
  .object({
    actorUserId: z.uuid(),
    connectionId: z.uuid(),
    grantVersion: z.number().int().positive().safe(),
    scopes: z.array(z.enum(builderScopes)).min(1),
    allowedMerchantIds: z.array(z.uuid()).max(1),
    allowCreateStore: z.boolean(),
    status: z.enum(['active', 'revoked', 'expired']),
    expiresAt: z.iso.datetime(),
    revokedAt: z.iso.datetime().nullable(),
  })
  .strict();
export type BuilderConnectionRecord = z.infer<typeof builderConnectionSchema>;
export const builderTokenClaimsSchema = z.object({
  sub: z.uuid(),
  connectionId: z.uuid(),
  grantVersion: z.number().int().positive().safe(),
  scope: z.string().min(1).max(256),
  exp: z.number().int().positive(),
});
export const builderConnectionViewsSchema = z
  .array(
    z
      .object({
        connection_id: z.uuid(),
        scopes: z.array(z.enum(builderScopes)),
        status: z.enum(['active', 'revoked', 'expired']),
        expires_at: z.iso.datetime({ offset: true }),
        created_at: z.iso.datetime({ offset: true }),
      })
      .strict()
  )
  .max(50);

export const builderDisconnectInputSchema = z
  .object({ connectionId: z.uuid() })
  .strict();
