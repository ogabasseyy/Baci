import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bookOrderShipmentSource = readFileSync(
  `${process.cwd()}/src/lib/shipping/book-order-shipment.ts`,
  'utf8'
);
const refreshWalletSource = readFileSync(
  `${process.cwd()}/src/lib/shipping/refresh-wallet-order-shipment-quote.ts`,
  'utf8'
);

function isWhitespace(value: string | undefined): boolean {
  return value !== undefined && /\s/.test(value);
}

function firstSelect(source: string, table: string): string | undefined {
  const fromMarker = `.from('${table}')`;
  let searchFrom = source.indexOf(fromMarker);
  if (searchFrom === -1) {
    return undefined;
  }
  const selectMarker = '.select(';
  for (;;) {
    const selectIndex = source.indexOf(selectMarker, searchFrom);
    if (selectIndex === -1) {
      return undefined;
    }
    let valueStart = selectIndex + selectMarker.length;
    while (isWhitespace(source[valueStart])) {
      valueStart += 1;
    }
    if (source[valueStart] === "'") {
      const valueEnd = source.indexOf("'", valueStart + 1);
      if (valueEnd !== -1 && valueEnd > valueStart + 1) {
        return source.slice(valueStart + 1, valueEnd);
      }
    }
    searchFrom = selectIndex + 1;
  }
}

describe('bugfix: booking SELECTs must not request revoked economics columns', () => {
  it('does not select revoked order economics from authenticated orders', () => {
    const orderSelect = firstSelect(bookOrderShipmentSource, 'orders');

    expect(orderSelect).toBeDefined();
    expect(orderSelect).not.toMatch(
      /shipping_provider_cost|shipping_platform_margin|shipping_platform_retained_amount|shipping_pricing_version/
    );
  });

  it('does not select revoked quote economics from authenticated shipping_quotes', () => {
    const quoteSelect = firstSelect(bookOrderShipmentSource, 'shipping_quotes');
    const walletQuoteSelect = firstSelect(
      refreshWalletSource,
      'shipping_quotes'
    );

    expect(quoteSelect).toBeDefined();
    expect(quoteSelect).not.toMatch(
      /provider_cost|platform_margin|platform_margin_bps|pricing_version|provider_metadata/
    );
    expect(walletQuoteSelect).toBeDefined();
    expect(walletQuoteSelect).not.toMatch(
      /provider_cost|platform_margin|platform_margin_bps|pricing_version|provider_metadata/
    );
    expect(bookOrderShipmentSource).toContain(
      'getShippingQuoteBookingEconomics'
    );
    expect(refreshWalletSource).toContain('getShippingQuoteBookingEconomics');
  });

  it('returns undefined when the table marker is missing', () => {
    expect(firstSelect(bookOrderShipmentSource, 'nonexistent_table')).toBeUndefined();
  });

  it('returns undefined for an empty quoted select value', () => {
    expect(
      firstSelect("supabase\n  .from('orders')\n  .select('')", 'orders')
    ).toBeUndefined();
  });

  it('skips an invalid select candidate before a valid select', () => {
    expect(
      firstSelect(
        "supabase\n  .from('orders')\n  .select(\n    columns\n  )\n  .select('id, status')",
        'orders'
      )
    ).toBe('id, status');
  });
});
