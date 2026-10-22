// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { expect, it } from 'vitest';
import {
  createBuilderAccountResolver,
  createBuilderUserClientResolver,
} from '@/lib/builder-connector/account-linking';
import { createBuilderAuthenticator } from '@/lib/builder-connector/authenticate';
import { createStorefrontDraftService } from '@/lib/website-builder/create-draft';
import { createPrivateHome } from '@/lib/website-builder/create-private-home';
import { commitDraft } from '@/lib/website-builder/private-drafts';
import { getStorefrontStatus } from '@/lib/website-builder/read-storefront';
import { startDraftApi } from '../builder-auth/draft-api-fixture.ts';
import { draftFixture } from '../builder-auth/draft-fixture.ts';
import { verifyAuthenticatedAsyncEdit } from './authenticated-async-edit.test-support';
import { verifyAuthenticatedGateway } from './authenticated-gateway.test-support';

it('same signed builder token: empty consent → real RLS create → fresh target → authenticated status/edit', async () => {
  const db = await draftFixture({ asyncEdits: true });
  let api: Awaited<ReturnType<typeof startDraftApi>> | undefined;
  try {
    const actor = randomUUID();
    const connection = randomUUID();
    await db.pool.query('INSERT INTO auth.users VALUES($1)', [actor]);
    await db.pool.query(
      "INSERT INTO builder_authorization.connections(id,actor_user_id,provider_grant_id,scopes,allow_create_store,expires_at) VALUES($1::uuid,$2,$1::text,ARRAY['storefront.read','storefront.write'],true,now()+interval '1 hour')",
      [connection, actor]
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
        )
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
      .setProtectedHeader({ alg: 'ES256', typ: 'at+jwt' })
      .setIssuer('https://auth.example.test')
      .setAudience('https://mcp.example.test/builder/mcp')
      .setSubject(actor)
      .setExpirationTime('5m')
      .sign(builder.privateKey);
    const authenticate = createBuilderAuthenticator({
      issuer: 'https://auth.example.test',
      audience: 'https://mcp.example.test/builder/mcp',
      key: builder.publicKey,
      readConnection: async (id) => {
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
      },
    });
    const request = () =>
      new Request('https://mcp.example.test/builder/mcp', {
        headers: { authorization: `Bearer ${token}` },
      });
    const deps = {
      supabase: { url: api.url, anonKey: 'fixture-public-key' },
      resolveLinkedAccessToken: async () => upstreamToken,
    };
    const initial = await authenticate(request());
    expect(initial.allowedMerchantIds).toEqual([]);
    const create = createStorefrontDraftService({
      resolveUserClient: createBuilderUserClientResolver(deps),
    });
    const created = await create(initial, {
      businessName: 'Journey Store',
      businessType: 'electronics',
      country: 'NG',
      requestedSlug: 'journey-store',
      idempotencyKey: randomUUID(),
    });
    const next = await authenticate(request());
    expect(next.allowedMerchantIds).toEqual([created.storefrontId]);
    expect(next.grantVersion).toBe(initial.grantVersion);
    const ctx = await createBuilderAccountResolver(deps)(
      next,
      created.storefrontId,
      'get_storefront_status'
    );
    expect((await getStorefrontStatus(ctx)).draftVersion).toBe(created.version);
    // The durable effect ledger has no exposed Data API endpoint or profile.
    for (const path of ['mutation_evidence', 'builder_mutation_evidence']) {
      const raw = await fetch(`${api.url}/rest/v1/${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${upstreamToken}`,
          'content-type': 'application/json',
        },
        body: '{}',
      });
      expect(raw.status).toBe(404);
    }
    const privateProfile = await fetch(`${api.url}/rest/v1/mutation_evidence`, {
      headers: {
        authorization: `Bearer ${upstreamToken}`,
        'Accept-Profile': 'builder_authorization',
      },
    });
    expect(privateProfile.status).toBe(406);
    const config = createPrivateHome('Journey Store');
    const hero = config.content.find((block) => block.type === 'Hero');
    if (hero?.type === 'Hero') hero.props.title = 'Edited Store';
    const edited = await commitDraft(ctx, {
      expectedVersion: created.version,
      idempotencyKey: randomUUID(),
      config,
    });
    expect(edited.status).toBe('draft');
    if (edited.status === 'draft')
      expect(edited.version).not.toBe(created.version);
    // An old client using the original public identity RPC also gets private reconciliation.
    const oldConfig = (
      await db.pool.query('SELECT draft_config FROM builder_page_drafts')
    ).rows[0].draft_config;
    const stamp = (
      await db.pool.query('SELECT updated_at::text AS stamp FROM merchants')
    ).rows[0].stamp;
    const rename = await ctx.supabase.rpc('update_merchant_identity_settings', {
      p_merchant_id: created.storefrontId,
      p_settings: { business_name: 'Renamed Store' },
      p_expected_updated_at: stamp,
    });
    expect(rename.error).toBeNull();
    expect(rename.data).not.toBeNull();
    const renamed = (
      await db.pool.query('SELECT draft_config FROM builder_page_drafts')
    ).rows[0].draft_config;
    expect(JSON.stringify(renamed)).not.toContain('Journey Store');
    // The edited title was independently authored, so an identity rename must preserve it.
    expect(oldConfig.root.props.title).toBe('Journey Store');
    expect(renamed.root.props.title).toBe('Renamed Store');
    expect(
      renamed.content.find((block: { type: string }) => block.type === 'Hero')
        .props.title
    ).toBe('Edited Store');
    expect(
      (
        await db.pool.query(
          'SELECT published_config,is_published FROM page_configs'
        )
      ).rows[0]
    ).toEqual({ published_config: null, is_published: false });
    await verifyAuthenticatedAsyncEdit(ctx, api.url, upstreamToken);
    const gateway = await verifyAuthenticatedGateway(
      ctx,
      authenticate,
      request,
      deps
    );
    await db.providerPool.query(
      "UPDATE builder_authorization.connections SET status='revoked',revoked_at=now(),grant_version=2 WHERE id=$1",
      [connection]
    );
    await gateway.verifyRevoked();
    await expect(authenticate(request())).rejects.toThrow('Reconnect');
    await expect(getStorefrontStatus(ctx)).rejects.toThrow('Reconnect');
    await expect(
      create(initial, {
        businessName: 'Journey Store',
        businessType: 'electronics',
        country: 'NG',
        requestedSlug: 'journey-store',
        idempotencyKey: randomUUID(),
      })
    ).rejects.toThrow('Reconnect');
  } finally {
    await api?.close();
    await db.close();
  }
}, 90000);
