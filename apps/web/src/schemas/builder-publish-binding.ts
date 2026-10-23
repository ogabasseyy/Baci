import { z } from 'zod';
import {
  BUILDER_POLICY_NAMESPACE,
  BUILDER_POLICY_VERSION,
  builderHomePagesSchema,
  builderHttpsUrlSchema,
  builderIdSchema,
  builderRevisionSchema,
} from './builder-mcp-primitives';

const binding = {
  actorUserId: builderIdSchema,
  connectionId: builderIdSchema,
  grantVersion: z.int().positive(),
  storefrontId: builderIdSchema,
  draftVersion: builderRevisionSchema,
  destinationUrl: builderHttpsUrlSchema,
  pageSlugs: builderHomePagesSchema,
  policyNamespace: z.literal(BUILDER_POLICY_NAMESPACE),
  policyVersion: z.literal(BUILDER_POLICY_VERSION),
  effectDigest: z.string().regex(/^[a-f0-9]{64}$/),
};
export const builderPublishIntentSchema = z
  .object({
    ...binding,
    intentId: builderIdSchema,
    nonce: z.string().min(16).max(256),
    issuedAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export const builderPublishExecutionSchema = z
  .object({
    ...binding,
    nonceConsumed: z.boolean(),
    approverAuthorized: z.boolean(),
    now: z.date().optional(),
  })
  .strict();
