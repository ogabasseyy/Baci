import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bookingContextSource = readFileSync(
  `${process.cwd()}/src/app/api/shipping/book/load-direct-booking-context.ts`,
  'utf8'
);

describe('shipping booking quote projection', () => {
  it('does not request raw provider metadata from authenticated shipping_quotes', () => {
    const quoteSelect = bookingContextSource.match(
      /\.from\('shipping_quotes'\)[\s\S]*?\.select\(\s*'([^']+)'/
    )?.[1];

    expect(quoteSelect).toBeDefined();
    expect(quoteSelect).not.toContain('provider_metadata');
    expect(bookingContextSource).toContain('getShippingQuoteBookingMetadata');
  });

  it('does not request restricted economics columns from authenticated shipping_quotes', () => {
    const quoteSelect = bookingContextSource.match(
      /\.from\('shipping_quotes'\)[\s\S]*?\.select\(\s*'([^']+)'/
    )?.[1];

    expect(quoteSelect).toBeDefined();
    expect(quoteSelect).not.toMatch(
      /provider_cost|platform_margin|platform_margin_bps|pricing_version/
    );
    expect(bookingContextSource).toContain('getShippingQuoteBookingEconomics');
  });
});
