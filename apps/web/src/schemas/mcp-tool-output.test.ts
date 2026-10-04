import { describe, expect, it } from 'vitest';
import { mcpToolOutputSchemas } from './mcp-tool-output';

describe('public MCP result schema validation', () => {
  it('rejects a fabricated delivery quote', () => {
    const result = {
      city: 'Ikeja',
      fee: null,
      policy_url: 'https://ogabassey.com/shipping',
      quote_available: false,
      state: 'Lagos',
      status: 'requires_checkout',
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
      mcpToolOutputSchemas.add_to_cart.safeParse({ success: true, quantity: 0 })
        .success
    ).toBe(false);
  });
});
