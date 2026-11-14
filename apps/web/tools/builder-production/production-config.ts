import { z } from 'zod';
import { validateCanonicalRootDomain } from '@/lib/experience/canonical-domain';
import { productionDeliveryOrigins } from '@/lib/experience/production-origins';
import { runnerEndpoint } from '../experience-runner/runner-transport';

const key = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/)
  .refine((value) => {
    const bytes = Buffer.from(value, 'base64url');
    return bytes.length === 32 && bytes.toString('base64url') === value;
  });
const port = z.number().int().min(1).max(65535);
const schema = z.strictObject({
  port,
  deliveryPort: port,
  authPort: port,
  verifierPort: port,
  verifierKey: key,
  backgroundBuilds: z.boolean().default(false),
  previewKey: key,
  buildKey: key,
  runner: z.strictObject({
    endpoint: z.string().min(1).max(1000),
    key,
    toolchainDigest: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  previewDatabaseUrl: z.string().min(1).max(4096),
  hostOrigin: z.string().max(1000),
  executionOrigin: z.string().max(1000),
  rootDomain: z.string().min(1).max(253),
  supabase: z.strictObject({
    url: z.string().max(1000),
    anonKey: z.string().max(8192),
  }),
});

/** Private operator input only. No request-selected paths, identities or keys. */
export function parseBuilderProductionConfig(input: unknown) {
  try {
    const config = schema.parse(input);
    if (
      new Set([
        config.port,
        config.deliveryPort,
        config.verifierPort,
        config.authPort,
      ]).size !== 4
    )
      throw Error();
    if (
      new Set([
        config.verifierKey,
        config.previewKey,
        config.buildKey,
        config.runner.key,
      ]).size !== 4
    )
      throw Error();
    const db = new URL(config.previewDatabaseUrl);
    if (
      db.protocol !== 'postgresql:' ||
      decodeURIComponent(db.username) !== 'baci_owner_preview_login' ||
      !db.password ||
      !db.hostname ||
      (db.port !== '' && db.port !== '5432') ||
      db.pathname !== '/postgres' ||
      db.search ||
      db.hash
    )
      throw Error();
    const supabase = new URL(config.supabase.url);
    if (
      supabase.protocol !== 'https:' ||
      supabase.origin !== config.supabase.url ||
      supabase.username ||
      supabase.password ||
      supabase.pathname !== '/' ||
      supabase.search ||
      supabase.hash ||
      !/^sb_publishable_[A-Za-z0-9_-]{8,}$/.test(config.supabase.anonKey)
    )
      throw Error();
    validateCanonicalRootDomain(config.rootDomain);
    productionDeliveryOrigins({
      executionOrigin: config.executionOrigin,
      hostOrigins: [
        config.hostOrigin,
        `https://synthetic-merchant.${config.rootDomain}`,
      ],
    });
    runnerEndpoint(config.runner.endpoint);
    return {
      ...config,
      artifactDirectory: '/var/lib/baci-builder/artifacts' as const,
      verifierKey: Buffer.from(config.verifierKey, 'base64url'),
      previewKey: Buffer.from(config.previewKey, 'base64url'),
      buildKey: Buffer.from(config.buildKey, 'base64url'),
      runner: {
        ...config.runner,
        key: Buffer.from(config.runner.key, 'base64url'),
      },
    };
  } catch {
    throw Error('INVALID_BUILDER_CONFIG');
  }
}
