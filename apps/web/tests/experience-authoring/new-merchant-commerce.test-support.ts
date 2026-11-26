import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { importJWK, SignJWT } from 'jose';
import { expect } from 'vitest';
import { getMerchantRateQuotes } from '@/app/api/shipping/quotes/merchant-rate-quotes';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import type { startCommerceDataApi } from '../experience-commerce/data-api';
import { setSyntheticShippingOrigin } from './combined-cart-fixture.test-support';
import type { experienceDataFixture } from './data-fixture.test-support';

type Fixture = Awaited<ReturnType<typeof experienceDataFixture>>;

export async function seedNewMerchantShipping(
  f: Fixture,
  storefrontId: string
) {
  if (process.env.BACI_LOCAL_COMBINED_COMMERCE_TEST !== '1') return undefined;
  const merchantCurrency = await f.other.supabase
    .from('merchants')
    .select('country,payout_currency')
    .eq('id', storefrontId)
    .single();
  expect(merchantCurrency.error).toBeNull();
  if (!merchantCurrency.data) throw Error('SYNTHETIC_MERCHANT_MISSING');
  expect(merchantCurrency.data.country).toBe('US');
  if (process.env.BACI_LOCAL_PUBLIC_READ_TEST === '1') {
    await setSyntheticShippingOrigin(f.other, storefrontId);
  }
  const currency = resolveMerchantCurrencyConfig(merchantCurrency.data).code;
  if (process.env.BACI_LOCAL_NATIVE_CHECKOUT_TEST !== '1')
    await f.db.pool.query(
      `UPDATE merchants SET premium_features='["shared_cart"]' WHERE id=$1`,
      [storefrontId]
    );
  const zone = await f.other.supabase
    .from('merchant_shipping_zones')
    .insert({ merchant_id: storefrontId, name: 'Synthetic US' })
    .select('id')
    .single();
  expect(zone.error).toBeNull();
  if (!zone.data) throw Error('SYNTHETIC_ZONE_MISSING');
  const foreignRate = await f.owner.supabase
    .from('merchant_shipping_rates')
    .insert({
      merchant_id: storefrontId,
      zone_id: zone.data.id,
      name: 'Denied foreign rate',
      kind: 'ship',
      currency,
      base_amount: 1,
      condition_type: 'always',
    });
  expect(foreignRate.error).not.toBeNull();
  const anonymousRates = await f.anonymous
    .from('merchant_shipping_rates')
    .select('id');
  expect(anonymousRates.error).not.toBeNull();
  expect(
    (
      await f.other.supabase.from('merchant_shipping_zone_locations').insert({
        zone_id: zone.data.id,
        country_code: 'US',
        subdivision_code: null,
      })
    ).error
  ).toBeNull();
  expect(
    (
      await f.other.supabase.from('merchant_shipping_rates').insert({
        merchant_id: storefrontId,
        zone_id: zone.data.id,
        name: 'Synthetic delivery',
        kind: 'ship',
        currency,
        base_amount: 1500,
        condition_type: 'always',
      })
    ).error
  ).toBeNull();
  return currency;
}

export async function checkNewMerchantCheckout(
  f: Fixture,
  commerceApi: Awaited<ReturnType<typeof startCommerceDataApi>> | undefined,
  storefrontId: string,
  productId: string,
  currency: string | undefined
) {
  if (process.env.BACI_LOCAL_COMBINED_COMMERCE_TEST === '1') {
    const api = commerceApi;
    if (!api) throw Error('LOCAL_COMMERCE_API_MISSING');
    if (!currency) throw Error('SYNTHETIC_CURRENCY_MISSING');
    const claims = {
      role: 'commerce_cart_shopper',
      exp: Math.floor(Date.now() / 1000) + 3600,
      cart_scope: 'bootstrap',
      cart_merchant_id: storefrontId,
      cart_principal_id: 'synthetic-new-merchant-guest',
    };
    if (api.privateJwk.kty !== 'EC') throw Error('INVALID_FIXTURE_KEY');
    const key = await importJWK({ ...api.privateJwk, kty: 'EC' }, 'ES256');
    const scopedClient = async (scope: Record<string, unknown>) => {
      const signed = await new SignJWT(scope)
        .setProtectedHeader({ alg: 'ES256', kid: api.privateJwk.kid })
        .setAudience('authenticated')
        .setExpirationTime('10m')
        .sign(key);
      return createClient(api.url, api.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${signed}` } },
      });
    };
    const bootstrapClient = await scopedClient(claims);
    const createdResponse = await bootstrapClient.rpc('commerce_cart_create', {
      p_operation_id: randomUUID(),
      p_lines: [],
      p_currency: currency,
    });
    expect(createdResponse.error).toBeNull();
    const createdCart = createdResponse.data;
    expect(createdCart.ok, JSON.stringify(createdCart)).toBe(true);
    const session = {
      ...claims,
      cart_scope: 'session',
      cart_id:
        createdCart.state.cartId ??
        createdCart.state.cart_id ??
        createdCart.state.id,
      cart_grant_id: createdCart.grantId,
    };
    const shopper = await scopedClient(session);
    const addedResponse = await shopper.rpc('commerce_cart_mutate', {
      p_cart_id: session.cart_id,
      p_operation_id: randomUUID(),
      p_expected_version: 1,
      p_command: {
        type: 'add',
        item: { productId: productId },
        quantity: 1,
      },
    });
    expect(addedResponse.error).toBeNull();
    const added = addedResponse.data;
    expect(added.ok, JSON.stringify(added)).toBe(true);
    const reviewResponse = await shopper.rpc('commerce_cart_prepare_checkout', {
      p_cart_id: session.cart_id,
      p_expected_version: added.state.version,
      p_operation_id: randomUUID(),
    });
    expect(reviewResponse.error).toBeNull();
    const review = reviewResponse.data;
    expect(review.ok, JSON.stringify(review)).toBe(true);
    process.stderr.write('SYNTHETIC_STAGE shipping_quote_start\n');
    const shipping = await getMerchantRateQuotes(f.anonymous, {
      merchantId: storefrontId,
      receiverCountryCode: 'US',
      receiverState: 'California',
      merchantCurrency: currency,
      cartSubtotal: 250,
    });
    expect(shipping.quotes).toContainEqual(
      expect.objectContaining({
        provider: 'MERCHANT',
        displayName: 'Synthetic delivery',
        price: 1500,
        currency,
      })
    );
    await expect(
      f.db.pool.query(
        "INSERT INTO orders(merchant_id,order_number) VALUES($1,'synthetic-denied')",
        [storefrontId]
      )
    ).rejects.toThrow('LOCAL_FIXTURE_ORDERS_DISABLED');
    expect(
      (await f.db.pool.query('SELECT count(*) FROM orders')).rows[0].count
    ).toBe('0');
  }
}
