import { z } from 'zod';

const uuid = z.uuid();
const grantVersion = z.number().int().positive().safe();

export const experienceBackgroundBuildInput = z.strictObject({
  connectionId: uuid,
  actorUserId: uuid,
  grantVersion,
  merchantId: uuid,
  jobId: uuid,
});

export const experienceBackgroundBuildConnection = z.object({
  connectionId: uuid,
  actorUserId: uuid,
  grantVersion,
  status: z.literal('active'),
  revokedAt: z.null(),
  expiresAt: z.string(),
  scopes: z.array(
    z.enum(['storefront.read', 'storefront.write', 'storefront.publish'])
  ),
  allowedMerchantIds: z.array(uuid).max(1),
  allowCreateStore: z.boolean(),
});

export type ExperienceBackgroundBuildInput = z.infer<
  typeof experienceBackgroundBuildInput
>;
