import { isAbsolute, normalize } from 'node:path';
import { z } from 'zod';
import {
  BUILDER_ISSUER,
  BUILDER_RESOURCE,
} from '../../src/lib/builder-connector/resource.ts';
import { builderAuthOperatorSchema } from '../../src/schemas/experience-builder-auth.ts';
import {
  MAX_CONNECTION_TTL_SECONDS,
  MIN_CONNECTION_TTL_SECONDS,
} from './connection-lifetime.ts';

const schema = builderAuthOperatorSchema(
  z,
  MIN_CONNECTION_TTL_SECONDS,
  MAX_CONNECTION_TTL_SECONDS
);

/** Parses only trusted operator input. It never exposes configuration values in errors. */
export function parseProductionAuthConfig(input: unknown) {
  try {
    const config = schema.parse(input);
    const db = new URL(config.databaseUrl);
    const role = decodeURIComponent(db.username);
    if (
      db.protocol !== 'postgresql:' ||
      !db.password ||
      !db.hostname ||
      (db.port !== '' && db.port !== '5432') ||
      db.pathname !== '/postgres' ||
      db.search ||
      db.hash ||
      !(
        role === 'baci_builder_auth_login' ||
        /^baci_builder_auth_login\.[a-z0-9]+$/.test(role)
      )
    )
      throw Error();
    if (
      !isAbsolute(config.socketPath) ||
      normalize(config.socketPath) !== config.socketPath ||
      !config.socketPath.startsWith('/run/baci-builder-auth/') ||
      !config.socketPath.endsWith('.sock')
    )
      throw Error();
    const callback = new URL(config.callback);
    if (
      callback.origin !== 'https://chatgpt.com' ||
      callback.username ||
      callback.password ||
      callback.search ||
      callback.hash ||
      !(
        callback.pathname === '/connector_platform_oauth_redirect' ||
        /^\/connector\/oauth\/[A-Za-z0-9_-]+$/.test(callback.pathname)
      )
    )
      throw Error();
    const supabase = new URL(config.supabase.url);
    if (
      supabase.protocol !== 'https:' ||
      supabase.username ||
      supabase.password ||
      supabase.pathname !== '/' ||
      supabase.search ||
      supabase.hash ||
      config.upstream.issuer !== `${supabase.origin}/auth/v1` ||
      !/^sb_publishable_[A-Za-z0-9_-]{8,}$/.test(config.supabase.anonKey)
    )
      throw Error();
    const keys = new Map(
      Object.entries(config.vault.keys).map(([id, key]) => [
        id,
        Buffer.from(key, 'base64url'),
      ])
    );
    if (
      !keys.has(config.vault.activeKeyId) ||
      keys.size > 3 ||
      new Set(config.cookieKeys).size !== config.cookieKeys.length ||
      new Set(config.signingKeys.map((key) => key.kid)).size !==
        config.signingKeys.length ||
      new Set(Object.values(config.vault.keys)).size !== keys.size ||
      config.cookieKeys.includes(config.upstream.clientSecret) ||
      config.signingKeys.some(
        (key) =>
          config.cookieKeys.includes(key.d) ||
          key.d === config.upstream.clientSecret
      ) ||
      Object.values(config.vault.keys).some(
        (key) =>
          config.cookieKeys.includes(key) ||
          config.signingKeys.some((signing) => signing.d === key) ||
          config.upstream.clientSecret === key
      )
    )
      throw Error();
    return {
      databaseUrl: config.databaseUrl,
      socketPath: config.socketPath,
      provider: {
        issuer: BUILDER_ISSUER,
        resource: BUILDER_RESOURCE,
        callback: config.callback,
        clientId: config.clientId,
        cookieKeys: config.cookieKeys,
        jwks: { keys: config.signingKeys },
      },
      vault: { activeKeyId: config.vault.activeKeyId, keys },
      upstream: {
        ...config.upstream,
        redirectUri: `${BUILDER_ISSUER}/upstream/callback`,
      },
      supabase: { url: supabase.origin, anonKey: config.supabase.anonKey },
      connectionTtlSeconds: config.connectionTtlSeconds,
    };
  } catch {
    throw Error('INVALID_AUTH_CONFIG');
  }
}
