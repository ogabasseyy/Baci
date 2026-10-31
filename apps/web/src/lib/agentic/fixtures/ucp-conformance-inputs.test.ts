// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubAgenticEnv } from '../test-support/stub-agentic-env';
import {
  buildProfile,
  cartResponse,
  LINE_MINOR,
  MAJOR_PRICE,
  MERCHANT,
  orderBody,
  searchResponse,
  UNIT_MINOR,
} from './ucp-conformance-inputs';

describe('UCP conformance inputs', () => {
  beforeEach(() => {
    vi.resetModules();
    stubAgenticEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('prices one unit at N39.98 so a rounding bug shows in minor units', () => {
    expect(MAJOR_PRICE).toBe(39.98);
    expect(UNIT_MINOR).toBe(Math.round(MAJOR_PRICE * 100));
    expect(LINE_MINOR).toBe(UNIT_MINOR * 2);
    expect(Number.isInteger(UNIT_MINOR)).toBe(true);
  });

  it('describes a Paystack merchant that offers pay on delivery', () => {
    expect(MERCHANT.slug).toBe('ogabassey');
    expect(MERCHANT.feature_settings).toEqual({
      pay_on_delivery_enabled: true,
    });
    expect(MERCHANT.paystack_subaccount_code).toBeTruthy();
  });

  it('builds a profile that declares the five shopping capabilities', async () => {
    const profile = await buildProfile();

    expect(
      Object.keys(profile.ucp.capabilities)
        .filter((name) => name.startsWith('dev.ucp.shopping.'))
        .sort()
    ).toEqual([
      'dev.ucp.shopping.cart',
      'dev.ucp.shopping.catalog.lookup',
      'dev.ucp.shopping.catalog.search',
      'dev.ucp.shopping.checkout',
      'dev.ucp.shopping.order',
    ]);
  });

  it('maps the product row into a one-product search response', () => {
    const { product, response } = searchResponse();

    expect(response.products).toEqual([product]);
    expect(product.title).toBe('Kobo phone');
  });

  it('builds a cart with one line of two units totalling the line amount', () => {
    const cart = cartResponse();

    expect(cart.currency).toBe('NGN');
    expect(cart.line_items).toHaveLength(1);
    expect(cart.line_items[0].quantity).toBe(2);
    expect(cart.totals.find((total) => total.type === 'total')?.amount).toBe(
      LINE_MINOR
    );
  });

  it('builds an order body in major units for the requested shipping status', () => {
    const body = orderBody('pending');

    expect(body.shipping_status).toBe('pending');
    expect(orderBody('delivered').shipping_status).toBe('delivered');
    expect(body.order_items[0].price).toBe(MAJOR_PRICE);
    expect(body.order_items[0].quantity).toBe(2);
    expect(body.total).toBe(body.order_items[0].line_extension_amount);
    expect(body.total).toBeCloseTo(MAJOR_PRICE * 2, 10);
  });

  it('returns the same inputs on every call', async () => {
    expect(orderBody('pending')).toEqual(orderBody('pending'));
    expect(cartResponse()).toEqual(cartResponse());
    expect(searchResponse().response).toEqual(searchResponse().response);
    expect(await buildProfile()).toEqual(await buildProfile());
  });
});
