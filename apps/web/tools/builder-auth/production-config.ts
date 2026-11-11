import { isAbsolute, normalize } from 'node:path';
import { z } from 'zod';

const bytes32 = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/)
  .refine((value) => {
    const bytes = Buffer.from(value, 'base64url');
    return bytes.length === 32 && bytes.toString('base64url') === value;
  });
const privateKey = z.strictObject({
  kty: z.literal('EC'),
  crv: z.literal('P-256'),
  x: bytes32,
  y: bytes32,
  d: bytes32,
  alg: z.literal('ES256'),
  kid: z.string().min(1).max(100),
});
const schema = z.strictObject({
  databaseUrl: z.string().min(1).max(4096),
  socketPath: z.string().min(1).max(100),
  clientId: z.literal('baci-chatgpt-builder-v1'),
  callback: z.string().url(),
  cookieKeys: z.array(z.string().min(32).max(256)).min(1).max(3),
  signingKeys: z.array(privateKey).min(1).max(3),
  vault: z.strictObject({
    activeKeyId: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
    keys: z.record(z.string().regex(/^[A-Za-z0-9_-]{1,40}$/), bytes32),
  }),
  upstream: z.strictObject({
    issuer: z.string().url(),
    clientId: z.string().min(1).max(256),
    clientSecret: z.string().min(16).max(1024),
  }),
  supabase: z.strictObject({
    url: z.string().url(),
    anonKey: z.string().min(1).max(8192),
  }),
  connectionTtlSeconds: z.number().int().min(300).max(2678400),
});

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
    const issuer = 'https://mcp.usebaci.com';
    return {
      databaseUrl: config.databaseUrl,
      socketPath: config.socketPath,
      provider: {
        issuer,
        resource: `${issuer}/builder/mcp`,
        callback: config.callback,
        clientId: config.clientId,
        cookieKeys: config.cookieKeys,
        jwks: { keys: config.signingKeys },
      },
      vault: { activeKeyId: config.vault.activeKeyId, keys },
      upstream: {
        ...config.upstream,
        redirectUri: `${issuer}/upstream/callback`,
      },
      supabase: { url: supabase.origin, anonKey: config.supabase.anonKey },
      connectionTtlSeconds: config.connectionTtlSeconds,
    };
  } catch {
    throw Error('INVALID_AUTH_CONFIG');
  }
}
