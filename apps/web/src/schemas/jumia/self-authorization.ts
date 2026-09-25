import { z } from 'zod';

export const jumiaSelfAuthorizationCredentialsSchema = z.object({
  clientId: z.string().trim().min(1).max(512),
  refreshToken: z.string().trim().min(1).max(8192),
});

export const jumiaDiscoveredShopSchema = z.object({
  id: z.string().trim().min(1),
  selectionKey: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1),
  countryCode: z.string().trim().min(1),
  marketplace: z.string().trim().min(1),
  alreadyConnected: z.boolean(),
});

export const jumiaSelfAuthorizationDiscoveryResponseSchema = z.object({
  discoveryId: z.uuid(),
  shops: z.array(jumiaDiscoveredShopSchema),
});

export const jumiaSelfAuthorizationSelectionSchema = z.object({
  clientId: jumiaSelfAuthorizationCredentialsSchema.shape.clientId,
  discoveryId: z.uuid(),
  selectedShopIds: z
    .array(z.string().trim().min(1))
    .min(1)
    .max(50)
    .refine(
      (ids) => new Set(ids).size === ids.length,
      'Duplicate shop IDs are not allowed'
    ),
});

export const jumiaSelfAuthorizationDiscoverySchema = z
  .object({
    connectionType: z.literal('self_authorization'),
    operation: z.literal('discover'),
    clientId: jumiaSelfAuthorizationCredentialsSchema.shape.clientId,
    refreshToken:
      jumiaSelfAuthorizationCredentialsSchema.shape.refreshToken.optional(),
    discoveryId: z.uuid().optional(),
  })
  .refine((value) => value.refreshToken || value.discoveryId, {
    message: 'A refresh token or discovery ID is required',
  });

export type JumiaSelfAuthorizationCredentials = z.infer<
  typeof jumiaSelfAuthorizationCredentialsSchema
>;

export type JumiaDiscoveredShop = z.infer<typeof jumiaDiscoveredShopSchema>;
