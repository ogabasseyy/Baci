import { once } from 'node:events';
import { generateKeyPair, SignJWT } from 'jose';
import { createBuilderAuthenticator } from '@/lib/builder-connector/authenticate';
import {
  createExperienceToolDispatcher,
  type ExperienceDispatcherDependencies,
} from '@/lib/experience/tool-dispatcher';
import { createExperienceGateway } from '@/lib/experience/tool-gateway';
import {
  BUILDER_ISSUER,
  BUILDER_RESOURCE,
} from '../../builder-mcp-server/metadata';
import { createBuilderMcpNodeServer } from '../../builder-mcp-server/node';
import { createBuilderTransportVerifier } from '../../builder-mcp-server/token-verifier';
import type { experienceDataFixture } from './data-fixture.test-support';

/** Synthetic outer token, real gateway and owner RLS; no network outside loopback. */
export async function startMcpRunnerFixture(
  f: Awaited<ReturnType<typeof experienceDataFixture>>,
  finalizeBuild: ExperienceDispatcherDependencies['finalizeBuild']
) {
  const keys = await generateKeyPair('ES256');
  const token = await new SignJWT({
    connectionId: f.connectionId,
    grantVersion: 1,
    scope: 'storefront.read storefront.write',
  })
    .setProtectedHeader({ alg: 'ES256', typ: 'at+jwt' })
    .setIssuer(BUILDER_ISSUER)
    .setAudience(BUILDER_RESOURCE)
    .setSubject(f.actorId)
    .setExpirationTime('5m')
    .sign(keys.privateKey);
  const authenticate = createBuilderAuthenticator({
    issuer: BUILDER_ISSUER,
    audience: BUILDER_RESOURCE,
    key: keys.publicKey,
    async readConnection(id) {
      const { rows } = await f.db.pool.query(
        `SELECT id AS "connectionId", actor_user_id AS "actorUserId", grant_version AS "grantVersion", scopes, allowed_merchant_ids AS "allowedMerchantIds", allow_create_store AS "allowCreateStore", status, expires_at AS "expiresAt", revoked_at AS "revokedAt" FROM builder_authorization.connections WHERE id=$1`,
        [id]
      );
      const row = rows[0];
      return (
        row && {
          ...row,
          grantVersion: Number(row.grantVersion),
          expiresAt: row.expiresAt.toISOString(),
          revokedAt: row.revokedAt?.toISOString() ?? null,
        }
      );
    },
  });
  const execute = createExperienceToolDispatcher({
    resolveUserClient: async () => f.owner.supabase,
    finalizeBuild,
    preview: () => Promise.reject(Error('Not exercised')),
  });
  const gateway = createExperienceGateway({ authenticate, execute });
  const runtime = createBuilderMcpNodeServer({
    experience: { enabled: true },
    verifyAccessToken: createBuilderTransportVerifier(keys.publicKey),
    executeBuilderTool: async (bearer, name, input) => {
      const response = await gateway(
        new Request('https://mcp.synthetic.test', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${bearer}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(input),
        }),
        name
      );
      return response.json();
    },
  });
  runtime.server.listen(0, '127.0.0.1');
  await once(runtime.server, 'listening');
  const address = runtime.server.address();
  if (!address || typeof address === 'string') {
    await runtime.close();
    throw Error('Missing listener');
  }
  return {
    async call(name: string, args: Record<string, unknown>) {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/builder/mcp`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name, arguments: args },
          }),
        }
      );
      if (response.status !== 200) throw Error(`MCP_HTTP_${response.status}`);
      const body = (await response.json()) as {
        result?: { structuredContent?: unknown };
      };
      return body.result?.structuredContent;
    },
    close: runtime.close,
  };
}
