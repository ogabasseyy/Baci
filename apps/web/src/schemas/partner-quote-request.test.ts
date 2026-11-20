import { expect, it } from 'vitest';
import { partnerQuoteRequestSchema } from './partner-quote-request';

it('allows only domestic destinations and complete coordinate pairs', () => {
  const base = {
    items: [{ listing_id: 'listing-one', quantity: 1 }],
    destination: {
      address_line1: '10 Example Street',
      city: 'Ikeja',
      state: 'Lagos',
      country_code: 'NG',
    },
  };
  expect(partnerQuoteRequestSchema.safeParse(base).success).toBe(true);
  expect(
    partnerQuoteRequestSchema.safeParse({
      ...base,
      destination: { ...base.destination, country_code: 'US' },
    }).success
  ).toBe(false);
  expect(
    partnerQuoteRequestSchema.safeParse({
      ...base,
      destination: { ...base.destination, coordinates: { latitude: 6.6 } },
    }).success
  ).toBe(false);
});
