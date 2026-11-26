import { validateCanonicalRootDomain } from '@/lib/experience/canonical-domain';
import { productionDeliveryOrigins } from '@/lib/experience/production-origins';
import { builderProductionConfig } from '@/schemas/experience-operator-config';
import { runnerEndpoint } from '../experience-runner/runner-transport';

function restrictedDatabaseUrl(value: string, login: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== 'postgresql:' ||
    decodeURIComponent(url.username) !== login ||
    !url.password ||
    !url.hostname ||
    (url.port !== '' && url.port !== '5432') ||
    url.pathname !== '/postgres' ||
    url.search ||
    url.hash
  )
    throw Error();
  return url;
}

/** Private operator input only. No request-selected paths, identities or keys. */
export function parseBuilderProductionConfig(input: unknown) {
  try {
    const config = builderProductionConfig.parse(input);
    if (
      new Set([
        config.port,
        config.deliveryPort,
        config.verifierPort,
        config.authPort,
        config.ownerPort,
      ]).size !== 5
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
    const previewDatabase = restrictedDatabaseUrl(
      config.previewDatabaseUrl,
      'baci_owner_preview_login'
    );
    const rendererDatabase = restrictedDatabaseUrl(
      config.rendererDatabaseUrl,
      'baci_experience_renderer_reader_login'
    );
    if (previewDatabase.host !== rendererDatabase.host) throw Error();
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
