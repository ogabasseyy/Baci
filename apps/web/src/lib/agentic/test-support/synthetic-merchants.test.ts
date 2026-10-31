// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mapUcpCatalogProductRow } from '@/lib/agentic/ucp-catalog-adapters';
import { merchantHasFeature } from '@/lib/merchant-has-feature';
import { getStorefrontAgentAvailability } from '@/lib/storefront-agent-availability';
import { stubAgenticEnv } from './stub-agentic-env';
import {
  buildSyntheticCatalog,
  SYNTHETIC_PRODUCT_SCENARIOS,
  type SyntheticCatalog,
} from './synthetic-catalog';
import {
  SYNTHETIC_MERCHANT_A,
  SYNTHETIC_MERCHANT_B,
} from './synthetic-merchants';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('synthetic merchants', () => {
  it('are two distinct tenants', () => {
    const [a, b] = [SYNTHETIC_MERCHANT_A, SYNTHETIC_MERCHANT_B];

    expect(a.context.id).not.toBe(b.context.id);
    expect(a.context.slug).not.toBe(b.context.slug);
    expect(a.baseUrl).not.toBe(b.baseUrl);
    expect(a.context.paystack_subaccount_code).not.toBe(
      b.context.paystack_subaccount_code
    );
    expect(a.record.id).toBe(a.context.id);
    expect(b.record.slug).toBe(b.context.slug);
    expect(a.context.id).toMatch(UUID);
  });

  it('differ in VAT registration and shared-cart enrolment', () => {
    expect(SYNTHETIC_MERCHANT_A.record.vat_registration_status).toBe(
      'registered'
    );
    expect(SYNTHETIC_MERCHANT_B.record.vat_registration_status).toBe(
      'not_registered'
    );
    expect(merchantHasFeature(SYNTHETIC_MERCHANT_A.record, 'shared_cart')).toBe(
      true
    );
    expect(merchantHasFeature(SYNTHETIC_MERCHANT_B.record, 'shared_cart')).toBe(
      false
    );
  });
});

describe('synthetic merchants through the real agent manifest', () => {
  beforeEach(() => {
    vi.resetModules();
    stubAgenticEnv('synthetic-alpha');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('enable checkout only for the one configured agentic merchant', async () => {
    const { buildAgentCommerceManifest } = await import(
      '@/lib/agentic/agent-commerce-manifest'
    );

    const a = buildAgentCommerceManifest(
      SYNTHETIC_MERCHANT_A.manifestMerchant,
      SYNTHETIC_MERCHANT_A.baseUrl
    );
    const b = buildAgentCommerceManifest(
      SYNTHETIC_MERCHANT_B.manifestMerchant,
      SYNTHETIC_MERCHANT_B.baseUrl
    );

    expect(a.store.slug).toBe('synthetic-alpha');
    expect(a.capabilities).toContain('checkout.session.complete');
    expect(a.payment_methods).toEqual([
      'paystack_bank_transfer',
      'pay_on_delivery',
    ]);
    // Single-tenant today: partner-scoped onboarding is roadmap Task 5.
    expect(b.auth).toBeNull();
    expect(b.capabilities).toEqual(['catalog.read']);
  });
});

describe('synthetic catalogs', () => {
  const catalogA = buildSyntheticCatalog(SYNTHETIC_MERCHANT_A);
  const catalogB = buildSyntheticCatalog(SYNTHETIC_MERCHANT_B);

  it('hold every scenario for each merchant', () => {
    for (const catalog of [catalogA, catalogB]) {
      expect(Object.keys(catalog).sort()).toEqual(
        [...SYNTHETIC_PRODUCT_SCENARIOS].sort()
      );
    }
  });

  it('never share an id across merchants or scenarios', () => {
    const ids = [catalogA, catalogB].flatMap((catalog) =>
      Object.values(catalog).flatMap((entry) => [
        entry.product.id,
        ...(entry.variant ? [entry.variant.id] : []),
      ])
    );

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => UUID.test(id))).toBe(true);
    expect(catalogA.kobo_price.row.merchant_id).toBe(
      SYNTHETIC_MERCHANT_A.context.id
    );
    expect(catalogB.kobo_price.row.merchant_id).toBe(
      SYNTHETIC_MERCHANT_B.context.id
    );
  });

  it('price the kobo product at 39.98 and 3998 minor units', () => {
    expect(catalogA.kobo_price.priceMajor).toBe(39.98);
    expect(catalogA.kobo_price.priceMinor).toBe(3998);
    for (const entry of Object.values(catalogA)) {
      expect(Math.round(entry.priceMajor * 100)).toBe(entry.priceMinor);
    }
  });

  it('keep a refurbished item and the variants for the stock scenarios', () => {
    expect(catalogA.refurbished.condition).toBe('refurbished');
    expect(catalogA.kobo_price.condition).toBe('new');
    for (const scenario of [
      'out_of_stock_variant',
      'unknown_stock_variant',
    ] as const) {
      const entry = catalogA[scenario];
      expect(entry.variant?.product_id).toBe(entry.product.id);
      expect(entry.variant?.merchant_id).toBe(SYNTHETIC_MERCHANT_A.context.id);
    }
  });

  it('read as in stock, out of stock and untracked through the real helpers', () => {
    const availability = (scenario: keyof SyntheticCatalog) =>
      getStorefrontAgentAvailability(catalogA[scenario].row);

    expect(availability('kobo_price')).toMatchObject({
      inventory_policy: 'tracked',
      is_purchasable: true,
    });
    expect(availability('out_of_stock_variant')).toMatchObject({
      inventory_policy: 'tracked',
      is_purchasable: false,
    });
    expect(availability('unknown_stock_variant')).toMatchObject({
      inventory_policy: 'untracked',
      quantity_available: null,
    });
    expect(catalogA.out_of_stock_variant.variant?.stock_quantity).toBe(0);
  });

  it('map into UCP catalog products', () => {
    const product = mapUcpCatalogProductRow({
      baseUrl: SYNTHETIC_MERCHANT_A.baseUrl,
      currency: 'NGN',
      row: catalogA.out_of_stock_variant.row,
    });

    expect(product?.variants[0].availability).toEqual({ available: false });
  });

  it('are identical on every build', () => {
    expect(buildSyntheticCatalog(SYNTHETIC_MERCHANT_A)).toEqual(catalogA);
  });
});
