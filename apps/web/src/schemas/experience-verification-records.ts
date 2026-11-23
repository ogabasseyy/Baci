import { z } from 'zod';

export const publicHeadReceipt = z.object({
  approvalId: z.uuid(),
  merchantId: z.uuid(),
  buildId: z.uuid(),
  receiptId: z.uuid(),
  effectDigest: z.string().regex(/^[a-f0-9]{64}$/),
  publishedVersion: z.number().int().positive().safe(),
  status: z.enum(['verifying', 'live']),
  action: z.enum(['publish', 'rollback']),
});

export const publicHeadApprovalId = z.uuid();
export const publicHeadBuildDigest = z.string().regex(/^[a-f0-9]{64}$/);
export const publicHeadMerchant = z.object({
  premium_features: z.unknown().optional(),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
});

export const verifierApprovalRecord = z.strictObject({
  approvalId: z.uuid(),
  kind: z.enum(['draft', 'lifecycle']),
  effectDigest: z.string().regex(/^[a-f0-9]{64}$/),
  markerDigest: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.iso.datetime({ offset: true }),
});

export const verifierPublicRecord = z.strictObject({
  receiptId: z.uuid(),
  effectDigest: z.string().regex(/^[a-f0-9]{64}$/),
  markerDigest: z.string().regex(/^[a-f0-9]{64}$/),
});

export type VerifierPublicRecord = z.infer<typeof verifierPublicRecord>;
