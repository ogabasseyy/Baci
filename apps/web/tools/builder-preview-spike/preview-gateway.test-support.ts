import type { Pool } from 'pg';
import { expect } from 'vitest';
import type { BuilderContext } from '@/lib/builder-connector/types';
import { previewStorefront } from '@/lib/website-builder/preview';
import { getStorefrontStatus } from '@/lib/website-builder/read-storefront';
/** Disposable SQL projection fixtures, not a production publication/readiness policy replay. */
export async function installPreviewProjectionFixture(pool: Pool) {
  await pool.query(`
 ALTER TABLE merchants ADD COLUMN phone text,ADD COLUMN support_email text,ADD COLUMN support_phone text,ADD COLUMN bank_code text,ADD COLUMN bank_account_number text;
 GRANT SELECT(phone,support_email,support_phone,bank_code,bank_account_number) ON merchants TO authenticated;
 CREATE TABLE products(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL REFERENCES merchants(id),name text NOT NULL,price numeric NOT NULL,slug text NOT NULL,status text NOT NULL,images jsonb,private_notes text,created_at timestamptz NOT NULL DEFAULT now());
 ALTER TABLE products ENABLE ROW LEVEL SECURITY;
 CREATE POLICY preview_fixture_products ON products FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM merchants m WHERE m.id=merchant_id AND m.user_id=auth.uid()));
 GRANT SELECT(id,merchant_id,name,price,slug,status,images,created_at) ON products TO authenticated;
 CREATE TABLE merchant_feature_settings(merchant_id uuid PRIMARY KEY REFERENCES merchants(id),paystack_enabled boolean,korapay_enabled boolean,pay_on_delivery_enabled boolean);
 ALTER TABLE merchant_feature_settings ENABLE ROW LEVEL SECURITY;
 CREATE POLICY preview_fixture_features ON merchant_feature_settings FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM merchants m WHERE m.id=merchant_id AND m.user_id=auth.uid()));
 GRANT SELECT ON merchant_feature_settings TO authenticated;
 CREATE FUNCTION get_merchant_paystack_subaccount_configured(p_merchant_id uuid) RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT false FROM public.merchants WHERE id=p_merchant_id AND user_id=auth.uid()$$;
 CREATE FUNCTION get_merchant_identity_verified(p_merchant_id uuid) RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$SELECT false FROM public.merchants WHERE id=p_merchant_id AND user_id=auth.uid()$$;
 GRANT EXECUTE ON FUNCTION get_merchant_paystack_subaccount_configured(uuid),get_merchant_identity_verified(uuid) TO authenticated;
 `);
}
export async function verifyPrivatePreview(ctx: BuilderContext, pool: Pool) {
  await pool.query(
    "INSERT INTO products(merchant_id,name,price,slug,status,images,private_notes) VALUES($1,'Published camera',125000,'published-camera','active','[]','never-preview'),($1,'Private draft product',100,'private-camera','draft','[]','never-preview')",
    [ctx.merchantId]
  );
  const status = await getStorefrontStatus(ctx);
  const input = {
    storefrontId: ctx.merchantId,
    pageSlug: 'home' as const,
    expectedVersion: status.draftVersion,
  };
  const result = await previewStorefront(ctx, input);
  expect(result).toMatchObject({
    version: status.draftVersion,
    projection: {
      identity: { business_name: 'Renamed Store', currency: 'NGN' },
      inert: true,
    },
  });
  expect(JSON.stringify(result)).toContain('Published camera');
  expect(JSON.stringify(result)).not.toMatch(
    /Private draft product|never-preview|bank_account|fixture@example/
  );
  if ('projection' in result) {
    expect(result.projection.catalog.products).toHaveLength(1);
    expect(result.readiness.ready).toBe(false);
    expect(result.readiness.missingItems.length).toBeGreaterThan(0);
  }
  const after = await getStorefrontStatus(ctx);
  expect(after.draftVersion).toBe(status.draftVersion);
  expect(after.isPublished).toBe(false);
  return () => previewStorefront(ctx, input);
}
