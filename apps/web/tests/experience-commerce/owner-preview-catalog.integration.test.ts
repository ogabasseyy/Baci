import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { expect, it } from 'vitest';
import {
  loadExperienceCatalog,
  loadOwnerPreviewCatalog,
} from '../../src/lib/experience/catalog-adapter';
import { loadOwnerPreviewBootstrap } from '../../src/lib/experience/owner-preview-bootstrap';
import { startDraftApi } from '../../tools/builder-auth/draft-api-fixture';
import { createCommerceEngineFixture } from './cart-engine-fixture';
import { prepareCommerceCatalog } from './catalog-fixture';

it('authorizes an unpublished synthetic catalog through signed user tokens and RLS, and rejects another owner and a revoked session', async () => {
  const f = await createCommerceEngineFixture();
  let api: Awaited<ReturnType<typeof startDraftApi>> | undefined;
  try {
    const ids = await prepareCommerceCatalog(f);
    const other = randomUUID();
    const session = randomUUID();
    const connection = randomUUID();
    await f.pool.query('INSERT INTO auth.users VALUES($1)', [other]);
    await f.pool.query('INSERT INTO auth.sessions VALUES($1,$2,NULL)', [
      session,
      other,
    ]);
    await f.pool.query('UPDATE merchants SET is_published=false WHERE id=$1', [
      ids.merchant,
    ]);
    // This compact catalog fixture normally models anonymous storefront reads.
    // Add the owner-access branch from the baseline product SELECT policy.
    await f.pool.query(`CREATE POLICY fixture_owner_products ON public.products FOR SELECT TO authenticated USING(public.has_merchant_access(merchant_id));
      CREATE POLICY fixture_owner_categories ON public.categories FOR SELECT TO authenticated USING(public.has_merchant_access(merchant_id));
      CREATE SCHEMA builder_authorization;
      CREATE TABLE builder_authorization.connections(id uuid,actor_user_id uuid,status text,revoked_at timestamptz,expires_at timestamptz,grant_version bigint,scopes text[],allowed_merchant_ids uuid[]);`);
    await f.pool.query(
      "INSERT INTO builder_authorization.connections VALUES($1,$2,'active',NULL,now()+interval '1 hour',1,ARRAY['storefront.read'],ARRAY[$3]::uuid[])",
      [connection, ids.owner, ids.merchant]
    );
    const lifecycle = readFileSync(
      new URL(
        '../../../../supabase/migrations/20261024180212_experience_lifecycle_foundation.sql',
        import.meta.url
      ),
      'utf8'
    );
    const functionSql = lifecycle.slice(
      lifecycle.indexOf('CREATE FUNCTION public.experience_authorize_read(')
    );
    if (
      !functionSql.startsWith('CREATE FUNCTION') ||
      !functionSql.includes(
        'GRANT EXECUTE ON FUNCTION public.experience_authorize_read'
      )
    )
      throw Error('MISSING_AUTHORIZATION_MIGRATION');
    await f.pool.query(functionSql);
    const keys = await generateKeyPair('ES256');
    const jwk = {
      ...(await exportJWK(keys.publicKey)),
      kid: 'fixture',
      alg: 'ES256',
    };
    api = await startDraftApi(
      '',
      jwk,
      () =>
        f.pool.query(
          'CREATE ROLE builder_draft_rest_fixture LOGIN NOINHERIT; GRANT anon,authenticated TO builder_draft_rest_fixture;'
        ),
      { socketDirectory: f.connection.host }
    );
    const token = (actor: string, sid: string) =>
      new SignJWT({ role: 'authenticated', session_id: sid })
        .setProtectedHeader({ alg: 'ES256', kid: 'fixture' })
        .setAudience('authenticated')
        .setSubject(actor)
        .setExpirationTime('5m')
        .sign(keys.privateKey);
    const client = (jwt: string) =>
      createClient(api?.url ?? '', 'fixture-public', {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${jwt}` } },
      });
    const owner = client(await token(ids.owner, ids.session));
    const otherClient = client(await token(other, session));
    const identity = {
      actorUserId: ids.owner,
      connectionId: connection,
      grantVersion: 1,
      scopes: new Set(['storefront.read'] as const),
      allowedMerchantIds: [ids.merchant],
      allowCreateStore: false,
    };
    const ctx = { merchantId: ids.merchant, supabase: owner, identity };
    const result = await loadOwnerPreviewCatalog(ctx, {});
    expect(result?.catalog.products.length).toBeGreaterThan(0);
    expect(
      result?.catalog.products.find((p) => p.slug === 'synthetic-device')
    ).toMatchObject({ price: 250, currency: 'NGN' });
    const manifest = {
      routes: [{ path: '/', view: 'home' }],
      capabilities: ['catalog.read'],
    } as never;
    expect(
      (await loadOwnerPreviewBootstrap(ctx, manifest, 'home')).catalog.products
        .length
    ).toBeGreaterThan(0);
    await expect(
      loadOwnerPreviewCatalog({ ...ctx, supabase: otherClient }, {})
    ).rejects.toThrow('NOT_FOUND');
    await expect(
      loadOwnerPreviewCatalog(
        {
          ...ctx,
          supabase: otherClient,
          identity: { ...identity, actorUserId: other },
        },
        {}
      )
    ).rejects.toThrow('NOT_FOUND');
    const publicClient = createClient(api.url, 'fixture-public', {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await expect(
      loadExperienceCatalog(
        publicClient,
        { id: ids.merchant, currency: 'NGN', is_published: false },
        {}
      )
    ).resolves.toBeNull();
    await f.pool.query(
      "UPDATE builder_authorization.connections SET status='revoked',revoked_at=now() WHERE id=$1",
      [connection]
    );
    await expect(loadOwnerPreviewCatalog(ctx, {})).rejects.toThrow('NOT_FOUND');
    await f.pool.query(
      "UPDATE builder_authorization.connections SET status='active',revoked_at=NULL WHERE id=$1",
      [connection]
    );
    await f.pool.query('DELETE FROM auth.sessions WHERE id=$1', [ids.session]);
    await expect(loadOwnerPreviewCatalog(ctx, {})).rejects.toThrow('NOT_FOUND');
    expect(
      (await f.pool.query('SELECT count(*) FROM orders')).rows[0].count
    ).toBe('0');
  } finally {
    await api?.close();
    await f.close();
  }
});
