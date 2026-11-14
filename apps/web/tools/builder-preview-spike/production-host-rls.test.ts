// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { getInstalledBuilderGateway } from '@/lib/builder-gateway/runtime';
import { startProductionBuilderHost } from '@/lib/experience/production-builder-host';
import { createProductionBuilderListener } from '@/lib/experience/production-builder-listener';
import { lifecycleFixture } from '../../tests/experience-lifecycle/sql.test-support';
import { startDraftApi } from '../builder-auth/draft-api-fixture.ts';
import { createTransientOutputStore } from '../experience-runner/transient-output-store';

it('creates and lists an unpublished synthetic store through the co-located gateway and real RLS', async () => {
  const db = await lifecycleFixture(
    false,
    process.env.BACI_BUILDER_LOCAL_PG === '1'
  );
  const dir = mkdtempSync(join(tmpdir(), 'baci-host-rls-'));
  let api: Awaited<ReturnType<typeof startDraftApi>> | undefined;
  let host: Awaited<ReturnType<typeof startProductionBuilderHost>> | undefined;
  let listener: ReturnType<typeof createProductionBuilderListener> | undefined;
  try {
    const actor = randomUUID();
    const connection = randomUUID();
    const otherActor = randomUUID();
    const otherConnection = randomUUID();
    await db.pool.query('INSERT INTO auth.users VALUES($1)', [actor]);
    await db.pool.query('INSERT INTO auth.users VALUES($1)', [otherActor]);
    await db.pool.query(
      "INSERT INTO builder_authorization.connections(id,actor_user_id,provider_grant_id,scopes,allow_create_store,expires_at) VALUES($1::uuid,$2,$1::text,ARRAY['storefront.read','storefront.write'],true,now()+interval '1 hour')",
      [connection, actor]
    );
    await db.pool.query(
      "INSERT INTO builder_authorization.connections(id,actor_user_id,provider_grant_id,scopes,allow_create_store,expires_at) VALUES($1::uuid,$2,$1::text,ARRAY['storefront.read'],false,now()+interval '1 hour')",
      [otherConnection, otherActor]
    );
    const upstream = await generateKeyPair('ES256');
    const builder = await generateKeyPair('ES256');
    api = await startDraftApi(
      db.containerName,
      {
        ...(await exportJWK(upstream.publicKey)),
        kid: 'upstream',
        alg: 'ES256',
      },
      () =>
        db.pool.query(
          'CREATE ROLE builder_draft_rest_fixture LOGIN NOINHERIT;GRANT anon,authenticated TO builder_draft_rest_fixture;'
        ),
      db.localDatabase
    );
    const upstreamToken = await new SignJWT({
      role: 'authenticated',
      email: 'fixture@example.test',
    })
      .setProtectedHeader({ alg: 'ES256', kid: 'upstream' })
      .setAudience('authenticated')
      .setSubject(actor)
      .setExpirationTime('5m')
      .sign(upstream.privateKey);
    const token = await new SignJWT({
      connectionId: connection,
      grantVersion: 1,
      scope: 'storefront.read storefront.write',
    })
      .setProtectedHeader({ alg: 'ES256', kid: 'builder', typ: 'at+jwt' })
      .setIssuer('https://builder-auth.usebaci.com')
      .setAudience('https://mcp.usebaci.com/builder/mcp')
      .setSubject(actor)
      .setExpirationTime('5m')
      .sign(builder.privateKey);
    const otherUpstreamToken = await new SignJWT({
      role: 'authenticated',
      email: 'other@example.test',
    })
      .setProtectedHeader({ alg: 'ES256', kid: 'upstream' })
      .setAudience('authenticated')
      .setSubject(otherActor)
      .setExpirationTime('5m')
      .sign(upstream.privateKey);
    const otherToken = await new SignJWT({
      connectionId: otherConnection,
      grantVersion: 1,
      scope: 'storefront.read',
    })
      .setProtectedHeader({ alg: 'ES256', kid: 'builder', typ: 'at+jwt' })
      .setIssuer('https://builder-auth.usebaci.com')
      .setAudience('https://mcp.usebaci.com/builder/mcp')
      .setSubject(otherActor)
      .setExpirationTime('5m')
      .sign(builder.privateKey);
    const readConnection = async (id: string) => {
      const row = (
        await db.pool.query(
          'SELECT id,actor_user_id,grant_version,scopes,allowed_merchant_ids,allow_create_store,status,expires_at,revoked_at FROM builder_authorization.connections WHERE id=$1',
          [id]
        )
      ).rows[0];
      return {
        connectionId: row.id,
        actorUserId: row.actor_user_id,
        grantVersion: Number(row.grant_version),
        scopes: row.scopes,
        allowedMerchantIds: row.allowed_merchant_ids,
        allowCreateStore: row.allow_create_store,
        status: row.status,
        expiresAt: row.expires_at.toISOString(),
        revokedAt: row.revoked_at?.toISOString() ?? null,
      };
    };
    host = await startProductionBuilderHost({
      startBroker: async () => ({
        runtime: {
          readConnection,
          resolveLinkedAccessToken: async (identity) =>
            identity.actorUserId === actor ? upstreamToken : otherUpstreamToken,
        },
        publicBinding: {
          supabase: { url: api?.url ?? '', anonKey: 'fixture-public-key' },
          jwks: {
            keys: [
              {
                ...(await exportJWK(builder.publicKey)),
                kid: 'builder',
                alg: 'ES256',
              },
            ],
          },
        },
        close: async () => {},
      }),
      integration: {
        hostOrigin: 'https://builder.baci.test',
        executionOrigin: 'https://output.runtime.test',
        artifactDirectory: dir,
        canonicalBase: (slug: string) =>
          `https://${slug}.merchant.test/${slug}`,
        publicClient: { rpc: vi.fn() } as never,
        approval: {
          load: vi.fn(),
          confirm: vi.fn(),
          loadLifecycle: vi.fn(),
          confirmPublication: vi.fn(),
          confirmModeExit: vi.fn(),
        },
        runner: {
          endpoint: 'https://runner.runtime.test/v1/execute',
          key: new Uint8Array(32).fill(1),
          toolchainDigest: 'a'.repeat(64),
        },
        build: {
          key: new Uint8Array(32).fill(2),
          toolchainDigest: 'a'.repeat(64),
          transient: createTransientOutputStore(),
          recordVerifiedEvidence: vi.fn(),
        },
        bootstrap: vi.fn(),
        recordCapture: vi.fn(),
      },
    });
    const gateway = getInstalledBuilderGateway();
    expect(gateway).toBeDefined();
    const call = (tool: string, input: unknown, bearer = token) =>
      gateway?.(
        new Request(
          `https://usebaci.com/api/integrations/chatgpt/builder/${tool}`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${bearer}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify(input),
          }
        ),
        tool
      );
    const created = await (
      await call('create_storefront_draft', {
        businessName: 'Synthetic Host Store',
        businessType: 'electronics',
        country: 'NG',
        requestedSlug: 'synthetic-host-store',
        idempotencyKey: randomUUID(),
      })
    )?.json();
    expect(created).toMatchObject({ status: 'draft' });
    const list = await (await call('list_storefronts', {}))?.json();
    expect(list.stores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          storefrontId: created.storefrontId,
          slug: 'synthetic-host-store',
        }),
      ])
    );
    listener = createProductionBuilderListener(host.publicJwks);
    listener.server.listen(0, '127.0.0.1');
    await once(listener.server, 'listening');
    const address = listener.server.address();
    if (!address || typeof address === 'string') throw Error('NO_LISTENER');
    const mcpList = (bearer: string) =>
      fetch(`http://127.0.0.1:${address.port}/builder/mcp`, {
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
          params: { name: 'list_storefronts', arguments: {} },
        }),
      });
    const mcpResult = await mcpList(token);
    expect(mcpResult.status).toBe(200);
    expect(JSON.stringify(await mcpResult.json())).toContain(
      'synthetic-host-store'
    );
    expect(
      JSON.stringify(await (await mcpList(otherToken)).json())
    ).not.toContain('synthetic-host-store');
    const stored = await db.pool.query(
      'SELECT is_published FROM merchants WHERE id=$1',
      [created.storefrontId]
    );
    expect(stored.rows[0].is_published).toBe(false);
    const otherList = await (
      await call('list_storefronts', {}, otherToken)
    )?.json();
    expect(otherList.stores).toEqual([]);
    const otherStatus = await (
      await call(
        'get_storefront_status',
        { storefrontId: created.storefrontId },
        otherToken
      )
    )?.json();
    expect(otherStatus).toMatchObject({ code: 'NOT_FOUND' });
    await db.providerPool.query(
      "UPDATE builder_authorization.connections SET status='revoked',revoked_at=now(),grant_version=2 WHERE id=$1",
      [connection]
    );
    expect((await call('list_storefronts', {}))?.status).toBe(401);
    expect(JSON.stringify(await (await mcpList(token)).json())).not.toContain(
      'synthetic-host-store'
    );
  } finally {
    await listener?.close();
    await host?.close();
    await api?.close();
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 90000);
