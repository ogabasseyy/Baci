import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { generateKeyPair, SignJWT } from 'jose';
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createBuilderAuthenticator } from '@/lib/builder-connector/authenticate';
import { digestBytes } from '@/lib/experience/manifest-digest';
import { createExperienceToolDispatcher } from '@/lib/experience/tool-dispatcher';
import { createExperienceGateway } from '@/lib/experience/tool-gateway';
import {
  BUILDER_ISSUER,
  BUILDER_RESOURCE,
} from '../../builder-mcp-server/metadata';
import { createBuilderMcpNodeServer } from '../../builder-mcp-server/node';
import { createBuilderTransportVerifier } from '../../builder-mcp-server/token-verifier';
import { experienceDataFixture } from './data-fixture.test-support';

it('routes full-code MCP calls to the owner RLS database and rejects a revoked grant', async () => {
  const f = await experienceDataFixture();
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
  const readOnlyToken = await new SignJWT({
    connectionId: f.connectionId,
    grantVersion: 1,
    scope: 'storefront.read',
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
      const result = await f.db.pool.query(
        `SELECT id AS "connectionId", actor_user_id AS "actorUserId",
           grant_version AS "grantVersion", scopes, allowed_merchant_ids AS "allowedMerchantIds",
           allow_create_store AS "allowCreateStore", status,
           expires_at AS "expiresAt", revoked_at AS "revokedAt"
         FROM builder_authorization.connections WHERE id=$1`,
        [id]
      );
      const row = result.rows[0];
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
    finalizeBuild: async () => {
      throw Error('Not exercised');
    },
    preview: async () => {
      throw Error('Not exercised');
    },
  });
  const gateway = createExperienceGateway({
    authenticate,
    execute,
  });
  const runtime = createBuilderMcpNodeServer({
    experience: { enabled: true },
    verifyAccessToken: createBuilderTransportVerifier(keys.publicKey),
    executeBuilderTool: async (token, name, input) => {
      const response = await gateway(
        new Request('https://mcp.synthetic.test', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
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
  try {
    const address = runtime.server.address();
    if (!address || typeof address === 'string')
      throw Error('Missing local listener');
    const call = async (
      name: string,
      input: Record<string, unknown>,
      bearer = token
    ) => {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/builder/mcp`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${bearer}`,
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name, arguments: input },
          }),
        }
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        result: {
          structuredContent: {
            status: string;
            code?: string;
            value?: Record<string, unknown>;
          };
        };
      };
      return body.result.structuredContent;
    };
    const store = { storefrontId: f.merchantId };
    const capabilities = await call('get_experience_capabilities', store);
    expect(capabilities).toMatchObject({
      status: 'ok',
      value: { mode: 'full-custom-code', aiProviderCalls: 0 },
    });
    expect(
      await call('get_experience_capabilities', { storefrontId: randomUUID() })
    ).toMatchObject({ status: 'error', code: 'NOT_FOUND' });
    const content =
      'export default function App(){return <h1>Synthetic MCP storefront</h1>}';
    const started = await call('begin_experience_upload', {
      ...store,
      manifest: {
        format: 'baci.experience/v2',
        runtime: 'react-browser-sandbox/v1',
        sdkVersion: 'commerce-bridge/v1',
        entry: 'app.tsx',
        files: [{ path: 'app.tsx', content: '' }],
        packages: [],
        routes: [{ path: '/', view: 'home' }],
        assets: [],
        capabilities: ['navigation', 'catalog.read'],
      },
      files: {
        files: [
          {
            path: 'app.tsx',
            bytes: Buffer.byteLength(content),
            digest: digestBytes(content),
          },
        ],
      },
    });
    expect(started.status).toBe('ok');
    const uploadId = started.value?.uploadId;
    expect(typeof uploadId).toBe('string');
    expect(
      await call(
        'write_experience_chunk',
        {
          ...store,
          uploadId,
          path: 'app.tsx',
          offset: 0,
          bytesBase64: Buffer.from(content).toString('base64'),
          chunkDigest: digestBytes(content),
        },
        readOnlyToken
      )
    ).toMatchObject({ status: 'error', code: 'INSUFFICIENT_SCOPE' });
    const chunk = await call('write_experience_chunk', {
      ...store,
      uploadId,
      path: 'app.tsx',
      offset: 0,
      bytesBase64: Buffer.from(content).toString('base64'),
      chunkDigest: digestBytes(content),
    });
    expect(chunk.status).toBe('ok');
    const finished = await call('finalize_experience_upload', {
      ...store,
      uploadId,
    });
    expect(finished.status).toBe('ok');
    const queued = await call('build_experience', {
      ...store,
      artifactId: finished.value?.artifactId,
      idempotencyKey: randomUUID(),
    });
    expect(queued.status).toBe('ok');
    const jobId = queued.value?.jobId;
    expect(typeof jobId).toBe('string');
    await f.db.pool.query(
      "UPDATE experience_jobs SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [jobId]
    );
    expect(
      await call('get_experience_operation', { ...store, jobId })
    ).toMatchObject({
      status: 'ok',
      value: { id: jobId, status: 'expired' },
    });
    const staleIdentity = await authenticate(
      new Request(BUILDER_RESOURCE, {
        headers: { authorization: `Bearer ${token}` },
      })
    );
    const revoker = await f.db.pool.connect();
    try {
      await revoker.query('BEGIN');
      await revoker.query(
        "SELECT set_config('request.jwt.claim.sub',$1,true)",
        [f.actorId]
      );
      await revoker.query(
        "UPDATE builder_authorization.connections SET status='revoked', revoked_at=now() WHERE id=$1",
        [f.connectionId]
      );
      await revoker.query('COMMIT');
    } finally {
      revoker.release();
    }
    const revoked = await call('get_experience_capabilities', store);
    expect(revoked).toMatchObject({
      status: 'error',
      code: 'CONNECTION_REVOKED',
    });
    // Even a stale identity already past the broker cannot bypass the SQL grant check.
    expect(
      await execute(staleIdentity, 'get_experience_capabilities', store)
    ).toMatchObject({ status: 'error' });
  } finally {
    await runtime.close();
    await f.close();
  }
}, 180000);
