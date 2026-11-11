import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import {
  resolveCanonicalBase,
  validateCanonicalRootDomain,
} from '@/lib/experience/canonical-domain';
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
  rootDomain: z.string().min(1).max(253),
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
    validateCanonicalRootDomain(config.rootDomain);
    productionDeliveryOrigins({
      executionOrigin: config.executionOrigin,
      hostOrigins: [
        config.previewOrigin,
        `https://synthetic-merchant.${config.rootDomain}`,
      ],
    });
    return {
      ...config,
      key: Buffer.from(config.key, 'base64url'),
      runner: {
        ...config.runner,
        key: Buffer.from(config.runner.key, 'base64url'),
      },
      canonicalBase: (slug: string, client: SupabaseClient) =>
        resolveCanonicalBase(client, slug, config.rootDomain),
    };
  } catch {
    throw Error('INVALID_VERIFIER_CONFIG');
  }
}
