import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { PoolClient } from 'pg';
import { createPrivateHome } from '../../src/lib/website-builder/create-private-home';
import { installPreviewProjectionFixture } from '../builder-preview-spike/preview-gateway.test-support';
import { asActor, draftFixture } from './draft-fixture';
export const publicationMigrations = [
  '20261022121000_builder_public_versions.sql',
  '20261022121100_builder_publication_receipts.sql',
  '20261022121200_builder_publication_intents.sql',
  '20261022121300_builder_publication_commit.sql',
  '20261022121400_builder_publication_delivery.sql',
  '20261022121500_builder_publication_status.sql',
];
export async function publicationFixture() {
  const db = await draftFixture({
    local: process.env.BACI_BUILDER_LOCAL_PG === '1',
    asyncEdits: true,
  });
  try {
    await installPreviewProjectionFixture(db.pool);
    await db.pool.query(
      `ALTER TABLE merchants ADD COLUMN paystack_subaccount_code text; CREATE TABLE merchant_verifications(merchant_id uuid PRIMARY KEY REFERENCES merchants(id),nin_verified boolean,bvn_verified boolean,cac_verified boolean); ALTER TABLE merchant_verifications ENABLE ROW LEVEL SECURITY; CREATE POLICY verification_owner ON merchant_verifications TO authenticated USING(EXISTS(SELECT 1 FROM merchants WHERE id=merchant_id AND user_id=auth.uid()));GRANT SELECT(merchant_id) ON merchant_verifications TO authenticated;CREATE FUNCTION has_merchant_access(p_id uuid) RETURNS boolean LANGUAGE sql SECURITY INVOKER AS $$SELECT EXISTS(SELECT 1 FROM public.merchants WHERE id=p_id AND user_id=auth.uid())$$;GRANT EXECUTE ON FUNCTION has_merchant_access(uuid) TO authenticated;GRANT UPDATE(status) ON products TO authenticated;CREATE POLICY product_write ON products FOR UPDATE TO authenticated USING(EXISTS(SELECT 1 FROM merchants WHERE id=merchant_id AND user_id=auth.uid())) WITH CHECK(EXISTS(SELECT 1 FROM merchants WHERE id=merchant_id AND user_id=auth.uid()));`
    );
    await db.pool.query(
      readFileSync(
        new URL(
          '../../../../supabase/migrations/20260729100000_add_merchant_identity_verified_rpc.sql',
          import.meta.url
        ),
        'utf8'
      )
    );
    await db.pool.query(
      `CREATE OR REPLACE FUNCTION get_merchant_paystack_subaccount_configured(p_merchant_id uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$SELECT coalesce(btrim(paystack_subaccount_code),'')<>'' FROM public.merchants WHERE id=p_merchant_id AND public.has_merchant_access(id)$$;`
    );
    for (const name of publicationMigrations)
      await db.pool.query(
        readFileSync(
          new URL(`../../../../supabase/migrations/${name}`, import.meta.url),
          'utf8'
        )
      );
    const actor = randomUUID();
    const connection = randomUUID();
    await db.pool.query('INSERT INTO auth.users VALUES($1)', [actor]);
    await db.pool.query(
      "INSERT INTO builder_authorization.connections(id,actor_user_id,provider_grant_id,scopes,allow_create_store,expires_at) VALUES($1::uuid,$2,$1::text,ARRAY['storefront.read','storefront.write','storefront.publish'],true,now()+interval '1 hour')",
      [connection, actor]
    );
    const run = async <T = unknown>(
      client: PoolClient,
      name: string,
      params: unknown[] = []
    ) => {
      const sql = `SELECT public.${name}(${params.map((_, i) => `$${i + 1}`).join(',')}) result`;
      return (await client.query(sql, params)).rows[0].result as T;
    };
    const owner = async <T>(
      fn: (client: PoolClient) => Promise<T>
    ): Promise<T> => {
      const c = await db.pool.connect();
      try {
        let result: T | undefined;
        await asActor(c, actor, async () => {
          result = await fn(c);
        });
        return result as T;
      } finally {
        c.release();
      }
    };
    const created = await owner((c) =>
      run<{ storefrontId: string; version: string }>(
        c,
        'builder_create_draft',
        [
          connection,
          1,
          randomUUID(),
          {
            businessName: 'Approval Fixture',
            businessType: 'electronics',
            country: 'US',
            requestedSlug: 'approval-fixture',
          },
          createPrivateHome('Approval Fixture'),
        ]
      )
    );
    await db.pool.query(
      "WITH m AS (UPDATE merchants SET country='US' WHERE id=$1 RETURNING id), f AS (INSERT INTO merchant_feature_settings(merchant_id,pay_on_delivery_enabled) SELECT id,true FROM m) INSERT INTO products(merchant_id,name,price,slug,status,images) SELECT id,'Approved camera',100,'approved-camera','active','[]' FROM m",
      [created.storefrontId]
    );
    const version = async () =>
      `draft:${(await db.pool.query('SELECT token FROM builder_website_revisions WHERE merchant_id=$1', [created.storefrontId])).rows[0].token}`;
    const key = randomUUID();
    const request = async (retry = key, expected?: string) => {
      const current = expected ?? (await version());
      return owner((c) =>
        run<Record<string, unknown>>(c, 'builder_request_publication', [
          connection,
          1,
          created.storefrontId,
          current,
          retry,
        ])
      );
    };
    const proof = async (
      intent: string,
      kind = 'render',
      receipt: string | null = null,
      publishedVersion?: string
    ) => {
      const row = (
        await db.pool.query(
          'SELECT effect_digest,source_version FROM builder_authorization.publication_intents WHERE id=$1',
          [intent]
        )
      ).rows[0];
      const id = randomUUID();
      const c = await db.pool.connect();
      try {
        await c.query('BEGIN');
        await c.query('SET LOCAL ROLE baci_builder_publication_verifier');
        await c.query(
          'INSERT INTO builder_authorization.publication_checks(id,intent_id,receipt_id,kind,version,effect_digest) VALUES($1,$2,$3,$4,$5,$6)',
          [
            id,
            intent,
            receipt,
            kind,
            publishedVersion ?? `draft:${row.source_version}`,
            row.effect_digest,
          ]
        );
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        c.release();
      }
      return id;
    };
    const close = () => db.close();
    return {
      ...db,
      actor,
      connection,
      merchantId: created.storefrontId,
      owner,
      run,
      version,
      key,
      request,
      proof,
      close,
    };
  } catch (e) {
    await db.close();
    throw e;
  }
}
