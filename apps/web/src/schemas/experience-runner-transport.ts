import { z } from 'zod';

export const experienceRunnerExecution = z.strictObject({
  output: z.record(z.string(), z.unknown()),
  wallMs: z.number().int().nonnegative(),
  jobId: z.string().min(1).max(200),
});
export const experienceRunnerRequest = z.strictObject({
  version: z.literal(1),
  nonce: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.number().int().positive(),
  toolchainDigest: z.string().regex(/^[a-f0-9]{64}$/),
  lane: z.enum(['owner', 'public-render']),
  kind: z.enum([
    'compile',
    'capture',
    'performance',
    'checks',
    'prerender',
    'prerender-checks',
    'prerender-build',
    'prerender-private-checks',
    'durable-public-checks',
  ]),
  payload: z.unknown(),
});

export function experienceRunnerReply(nonce: string) {
  return z.strictObject({ nonce: z.literal(nonce), output: z.unknown() });
}
