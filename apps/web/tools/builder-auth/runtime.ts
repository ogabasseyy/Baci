import type { IncomingMessage } from 'node:http';
import type { Pool } from 'pg';
import { createLinkedEditRunner } from './edit-runner.ts';
import { createOpaqueVault } from './opaque-vault.ts';
import { createBuilderProvider, type ProviderSettings } from './provider.ts';
import { createBuilderAuthHandler } from './server.ts';
import { createLinkedSessionService } from './session-service.ts';
import { createSessionVault } from './session-vault.ts';
import { createAuthStorage } from './storage.ts';
import { createUpstreamOAuth } from './upstream-client.ts';
import { getLinkedUser } from './user-client.ts';
/** Explicit composition only. Importing this module starts no server or connection. */
export async function createBuilderAuthRuntime(settings: {
  pool: Pool;
  provider: ProviderSettings;
  vault: { activeKeyId: string; keys: ReadonlyMap<string, Uint8Array> };
  upstream: {
    issuer: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };
  supabase: { url: string; anonKey: string };
  connectionTtlSeconds: number;
  authenticateDisconnect: (request: IncomingMessage) => Promise<string>;
}) {
  const check = await settings.pool.query<{
    role: string;
    member: boolean;
    unsafe: boolean;
  }>(
    `SELECT current_user AS role,pg_has_role(current_user,'authenticated','MEMBER') AS member,(SELECT rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb FROM pg_roles WHERE rolname=current_user) AS unsafe`
  );
  if (
    check.rows[0]?.role !== 'baci_builder_auth_storage' ||
    check.rows[0].member ||
    check.rows[0].unsafe
  )
    throw new Error('Unsafe builder auth database role');
  if (
    new URL(settings.supabase.url).origin !==
      new URL(settings.upstream.issuer).origin ||
    settings.upstream.redirectUri !==
      `${settings.provider.issuer}/upstream/callback`
  )
    throw new Error('Invalid upstream binding');
  for (const key of settings.vault.keys.values()) {
    const encoded = Buffer.from(key).toString('base64url');
    if (
      settings.provider.cookieKeys.includes(encoded) ||
      settings.provider.jwks.keys.some(
        (jwk) => 'd' in jwk && jwk.d === encoded
      ) ||
      settings.upstream.clientSecret === encoded
    )
      throw new Error('Builder keys must be separate');
  }
  const storage = createAuthStorage(
    settings.pool,
    createSessionVault(settings.vault),
    createOpaqueVault(settings.vault.activeKeyId, settings.vault.keys)
  );
  const upstream = await createUpstreamOAuth(settings.upstream);
  const provider = createBuilderProvider(settings.provider, storage);
  const resolveLinkedAccessToken = createLinkedSessionService({
    storage,
    refresh: upstream.refresh,
    verifyUser: async (token) =>
      (await getLinkedUser(settings.supabase, token)).actorUserId,
  });
  const handler = createBuilderAuthHandler({
    provider,
    storage,
    upstream,
    issuer: settings.provider.issuer,
    resource: settings.provider.resource,
    supabase: settings.supabase,
    connectionTtlSeconds: settings.connectionTtlSeconds,
    authenticateDisconnect: settings.authenticateDisconnect,
  });
  return {
    handler,
    readConnection: storage.readConnection,
    resolveLinkedAccessToken,
    editRunner: createLinkedEditRunner({
      listConnections: storage.listActiveEditConnections,
      readConnection: storage.readConnection,
      resolveLinkedAccessToken,
      resolveUser: (token) => getLinkedUser(settings.supabase, token),
    }),
  };
}
