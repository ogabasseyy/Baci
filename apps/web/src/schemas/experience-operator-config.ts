import { z } from 'zod';

export const runnerPreflightReceipt = z.strictObject({
  toolchainDigest: z.string().regex(/^[a-f0-9]{64}$/),
});

export const runnerProductionConfig = z.strictObject({
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

const bytes32 = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/)
  .refine(
    (value) =>
      Buffer.from(value, 'base64url').length === 32 &&
      Buffer.from(value, 'base64url').toString('base64url') === value
  );
export const verifierProductionConfig = z.strictObject({
  databaseUrl: z.string().min(1).max(4096),
  port: z.number().int().min(1).max(65535),
  key: bytes32,
  runner: z.strictObject({
    endpoint: z.string().min(1).max(1000),
    key: bytes32,
    toolchainDigest: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  previewOrigin: z.string().max(1000),
  executionOrigin: z.string().max(1000),
  supabase: z.strictObject({
    url: z.string().max(1000),
    anonKey: z.string().max(8192),
  }),
  rootDomain: z.string().min(1).max(253),
  publicObserver: z.literal('co-located').optional(),
});

const key = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/)
  .refine((value) => {
    const bytes = Buffer.from(value, 'base64url');
    return bytes.length === 32 && bytes.toString('base64url') === value;
  });
const port = z.number().int().min(1).max(65535);
export const builderProductionConfig = z.strictObject({
  port,
  deliveryPort: port,
  authPort: port,
  ownerPort: port,
  verifierPort: port,
  verifierKey: key,
  backgroundBuilds: z.literal(true).optional(),
  previewKey: key,
  buildKey: key,
  runner: z.strictObject({
    endpoint: z.string().min(1).max(1000),
    key,
    toolchainDigest: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  previewDatabaseUrl: z.string().min(1).max(4096),
  rendererDatabaseUrl: z.string().min(1).max(4096),
  hostOrigin: z.string().max(1000),
  executionOrigin: z.string().max(1000),
  rootDomain: z.string().min(1).max(253),
  supabase: z.strictObject({
    url: z.string().max(1000),
    anonKey: z.string().max(8192),
  }),
});
