import { expect, it } from 'vitest';
import { buildPartnerQuoteParcel } from './quote-parcel';

it('computes rounded VAT for each taxable line and preserves the carrier parcel', () => {
  const lines = [
    {
      product_id: 'standard',
      title: 'Phone',
      quantity: 1,
      base_unit_price_minor: 10005,
    },
    {
      product_id: 'exempt',
      title: 'Exempt item',
      quantity: 2,
      base_unit_price_minor: 10000,
    },
  ];
  const products = [
    {
      id: 'standard',
      name: 'Stored product name',
      vat_rate: '7.50',
      weight_value: 500,
      weight_unit: 'g',
    },
    { id: 'exempt', vat_category_code: 'E', vat_rate: '7.50' },
  ];

  expect(buildPartnerQuoteParcel(lines, products, true)).toEqual({
    items: [
      { name: 'Stored product name', quantity: 1, value: 100.05, weight: 0.5 },
      { name: 'Exempt item', quantity: 2, value: 100, weight: 1 },
    ],
    taxMinor: 750,
  });
  expect(buildPartnerQuoteParcel(lines, products, false)?.taxMinor).toBe(0);
  expect(buildPartnerQuoteParcel(lines, [], true)).toBeNull();
});
