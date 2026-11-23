import { z } from 'zod';
import { experiencePreviewInput } from './experience-preview';

export const experienceOwnerSubject = z.uuid();

const envelope = {
  version: z.literal(1),
  nonce: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.number().int().safe(),
  accessToken: z
    .string()
    .min(1)
    .max(8192)
    .regex(/^[A-Za-z0-9_.-]+$/),
};

export const experienceOwnerWireSchemas = {
  'owner-preview/v1': z.strictObject({
    ...envelope,
    input: experiencePreviewInput,
  }),
  'verifier-attest/v1': z.strictObject({
    ...envelope,
    approvalId: z.uuid(),
    kind: z.enum(['draft', 'lifecycle']),
  }),
  'verifier-public/v1': z.strictObject({
    ...envelope,
    approvalId: z.uuid(),
  }),
};
