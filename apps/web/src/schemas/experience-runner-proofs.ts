import { z } from 'zod';

export const experienceJobTicket = z.strictObject({
  jobId: z.string().min(1).max(100),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  attemptNonce: z.string().min(1).max(100),
  audience: z.literal('experience-output'),
  toolchainDigest: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.number().int().positive(),
  maxBytes: z.number().int().positive().max(16777216),
});
export type JobTicket = z.infer<typeof experienceJobTicket>;

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const gate = z.strictObject({
  status: z.enum(['passed', 'failed', 'missing', 'skipped']),
  sourceDigest: hash,
  evidence: z.string().min(1).max(1000),
});
export const releaseManifestInput = z.strictObject({
  candidateSha: z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .nullable(),
  sourceDigest: hash,
  lockDigest: hash,
  toolchainDigest: hash,
  runtimeDigest: hash,
  rollbackBuild: hash.nullable(),
  gates: z.strictObject({
    unit: gate,
    types: gate,
    lint: gate,
    sql: gate,
    browser: gate,
    linux: gate,
    noAi: gate,
    review: gate,
    ciFull: gate,
    ciTargeted: gate,
  }),
});
