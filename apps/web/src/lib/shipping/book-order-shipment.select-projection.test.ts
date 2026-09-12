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

function firstSelect(source: string, table: string): string | undefined {
  return source.match(
    new RegExp(String.raw`\.from\('${table}'\)[\s\S]*?\.select\(\s*'([^']+)'`)
  )?.[1];
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
});
