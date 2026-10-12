import { z } from 'zod';

const configSchema = z
  .object({
    environment: z.literal('staging'),
    integrationToken: z.string().regex(/^[a-f0-9]{64}$/),
    providerSecret: z.string().regex(/^test_key_[A-Za-z0-9]+$/),
    encryptionKey: z.string().refine((value) => {
      const decoded = Buffer.from(value, 'base64');
      return decoded.length === 32 && decoded.toString('base64') === value;
    }),
    restToken: z.string().max(4096),
  })
  .strict();

const claimsSchema = z.object({
  role: z.literal('pvb_staging_ingest'),
  exp: z.number().int().positive(),
});

export function parseIntakeConfig(input: unknown, now = Date.now()) {
  const config = configSchema.parse(input);
  const segments = config.restToken.split('.');
  if (
    segments.length !== 3 ||
    segments.some((segment) => !/^[A-Za-z0-9_-]+$/.test(segment))
  ) {
    throw new Error('Invalid restricted database token');
  }
  const claims = claimsSchema.parse(
    JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'))
  );
  if (claims.exp * 1000 <= now)
    throw new Error('Restricted database token expired');
  return {
    ...config,
    encryptionKey: Buffer.from(config.encryptionKey, 'base64'),
  };
}
