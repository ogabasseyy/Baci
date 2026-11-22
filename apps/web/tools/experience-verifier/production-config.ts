import type { SupabaseClient } from '@supabase/supabase-js';
import {
  resolveCanonicalBase,
  validateCanonicalRootDomain,
} from '@/lib/experience/canonical-domain';
import { productionDeliveryOrigins } from '@/lib/experience/production-origins';
import { verifierProductionConfig } from '@/schemas/experience-operator-config';
import { runnerEndpoint } from '../experience-runner/runner-transport';

/** Operator input only; errors never contain credentials or configuration. */
export function parseVerifierProductionConfig(input: unknown) {
  try {
    const config = verifierProductionConfig.parse(input);
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
      canonicalBase: (
        slug: string,
        client: SupabaseClient,
        signal?: AbortSignal
      ) => resolveCanonicalBase(client, slug, config.rootDomain, signal),
    };
  } catch {
    throw Error('INVALID_VERIFIER_CONFIG');
  }
}
