import { describe, expect, it } from 'vitest';
import { mcpToolOutputSchemas } from './mcp-tool-output';

describe('public MCP result schema validation', () => {
  it('rejects delivery amounts or availability without a quoted shipment', () => {
    const result = {
      city: 'Ikeja',
      fee: null,
      policy_url: 'https://ogabassey.com/shipping',
      quote_available: false,
      state: 'Lagos',
      status: 'unavailable',
      message: 'Confirm at checkout.',
      quotes: [],
    };
    expect(
      mcpToolOutputSchemas.get_delivery_fee_info.safeParse(result).success
    ).toBe(true);
    expect(
      mcpToolOutputSchemas.get_delivery_fee_info.safeParse({
        ...result,
        fee: 2000,
      }).success
    ).toBe(false);
    expect(
      mcpToolOutputSchemas.get_delivery_fee_info.safeParse({
        ...result,
        quote_available: true,
      }).success
    ).toBe(false);
  });

  it('accepts labelled GIG estimates with expiry and rejects empty quoted results', () => {
    const result = {
      city: 'Ikeja',
      state: 'Lagos',
      fee: null,
      policy_url: 'https://ogabassey.com/shipping',
      quote_available: true,
      status: 'quoted',
      message: 'Choose delivery type.',
      quotes: [
        {
          provider: 'GIGL',
          service: 'GoStandard',
          fee: 2000,
          currency: 'NGN',
          delivery_type: 'pickup_station',
          expires_at: '2099-01-01T00:00:00.000Z',
          station_name: 'IKEJA',
          station_address: 'Station fixture',
        },
      ],
    };
    expect(
      mcpToolOutputSchemas.get_delivery_fee_info.safeParse(result).success
    ).toBe(true);
    expect(
      mcpToolOutputSchemas.get_delivery_fee_info.safeParse({
        ...result,
        quotes: [],
      }).success
    ).toBe(false);
  });

  it('keeps unknown stock nullable and rejects string quantities and prices', () => {
    const result = {
      variants: [
        {
          attributes: { storage: '128GB' },
          price_override: null,
          stock_quantity: null,
          availability: 'unconfirmed',
        },
      ],
      condition_offers: [],
    };
    expect(
      mcpToolOutputSchemas.get_product_variants.safeParse(result).success
    ).toBe(true);
    for (const patch of [
      { stock_quantity: '2' },
      { price_override: '10000' },
      { availability: 'available' },
    ]) {
      expect(
        mcpToolOutputSchemas.get_product_variants.safeParse({
          ...result,
          variants: [{ ...result.variants[0], ...patch }],
        }).success
      ).toBe(false);
    }
  });

  it('rejects meaningless envelopes and malformed facet results', () => {
    for (const schema of Object.values(mcpToolOutputSchemas)) {
      expect(schema.safeParse({}).success).toBe(false);
    }
    expect(
      mcpToolOutputSchemas.browse_categories.safeParse({ categories: [123] })
        .success
    ).toBe(false);
    expect(
      mcpToolOutputSchemas.get_brands.safeParse({ brands: [] }).success
    ).toBe(true);
    expect(
      mcpToolOutputSchemas.prepare_storefront_cart_link.safeParse({
        success: true,
        quantity: 0,
      }).success
    ).toBe(false);
  });
});
