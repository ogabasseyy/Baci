import { z } from 'zod';
import { productionDeliveryOrigins } from '@/lib/experience/production-origins';
import { runnerEndpoint } from '../experience-runner/runner-transport';

const bytes32 = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/)
  .refine(
    (value) =>
      Buffer.from(value, 'base64url').length === 32 &&
      Buffer.from(value, 'base64url').toString('base64url') === value
  );
const schema = z.strictObject({
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
  canonicalTemplate: z.string().min(1).max(1000),
});

/** Operator input only; errors never contain credentials or configuration. */
export function parseVerifierProductionConfig(input: unknown) {
  try {
    const config = schema.parse(input);
    const db = new URL(config.databaseUrl);
    const login = decodeURIComponent(db.username);
    if (
      db.protocol !== 'postgresql:' ||
      !db.password ||
      !db.hostname ||
      (db.port !== '' && db.port !== '5432') ||
      db.pathname !== '/postgres' ||
      db.search ||
      db.hash ||
      !(
        login === 'baci_experience_verifier_login' ||
        /^baci_experience_verifier_login\.[a-z0-9]+$/.test(login)
      )
    )
      throw Error();
    runnerEndpoint(config.runner.endpoint);
    if (config.key === config.runner.key) throw Error();
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
    if (config.canonicalTemplate.split('{slug}').length !== 2) throw Error();
    const sample = new URL(
      config.canonicalTemplate.replace('{slug}', 'synthetic-merchant')
    );
    if (sample.username || sample.password || sample.search || sample.hash)
      throw Error();
    productionDeliveryOrigins({
      executionOrigin: config.executionOrigin,
      hostOrigins: [config.previewOrigin, sample.origin],
    });
    const template = config.canonicalTemplate;
    return {
      ...config,
      key: Buffer.from(config.key, 'base64url'),
      runner: {
        ...config.runner,
        key: Buffer.from(config.runner.key, 'base64url'),
      },
      canonicalBase: (slug: string) => {
        if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug))
          throw Error('INVALID_MERCHANT_SLUG');
        return template.replace('{slug}', slug);
      },
    };
  } catch {
    throw Error('INVALID_VERIFIER_CONFIG');
  }
}
