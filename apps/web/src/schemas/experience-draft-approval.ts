import { z } from 'zod';
import { experienceApprovalId } from './experience-publication';

const id = experienceApprovalId;
const pendingDraftApproval = z.strictObject({
  approvalId: id,
  merchantId: id,
  buildId: id,
  evidenceId: id,
  effectDigest: z.string().regex(/^[a-f0-9]{64}$/),
  expectedVersion: z.number().int().nonnegative(),
  expiresAt: z.iso.datetime({ offset: true }),
  status: z.literal('confirmation-required'),
});
export const experienceDraftApprovalResult = z.union([
  pendingDraftApproval,
  z.strictObject({
    status: z.literal('applied'),
    approvalId: id,
    merchantId: id,
    buildId: id,
    version: z.number().int().positive(),
  }),
]);

export const experienceDraftApplyResult = z.strictObject({
  buildId: id,
  version: z.number().int().positive(),
});
