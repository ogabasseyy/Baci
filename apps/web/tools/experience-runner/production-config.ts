import { z } from 'zod';

const schema = z.strictObject({
  key: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/)
    .refine((value) => {
      const bytes = Buffer.from(value, 'base64url');
      return bytes.length === 32 && bytes.toString('base64url') === value;
    }),
  toolchainDigest: z.string().regex(/^[a-f0-9]{64}$/),
  loopbackPort: z.number().int().min(1).max(65535),
});

/** Private operator input cannot select the listener or preflight executable. */
export function parseRunnerProductionConfig(input: unknown) {
  try {
    const config = schema.parse(input);
    return {
      key: Buffer.from(config.key, 'base64url'),
      toolchainDigest: config.toolchainDigest,
      loopbackPort: config.loopbackPort,
      socketPath: '/var/lib/baci-experience-runner/run/runner.sock',
    };
  } catch {
    throw Error('INVALID_RUNNER_CONFIG');
  }
}
