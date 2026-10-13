import { describe, expect, it } from 'vitest';
import {
  jumiaConsignmentCreateSchema,
  jumiaConsignmentGetQuerySchema,
  jumiaConsignmentUpdateSchema,
} from './consignment-api';

const integrationId = '00000000-0000-4000-8000-000000000001';

describe('Jumia consignment API schemas', () => {
  it('accepts a valid stock query', () => {
    expect(
      jumiaConsignmentGetQuerySchema.parse({
        integrationId,
        sku: 'SKU-1',
        businessClientCode: 'NG',
      })
    ).toMatchObject({ integrationId, sku: 'SKU-1', businessClientCode: 'NG' });
  });

  it('rejects malformed query identifiers and empty fields', () => {
    expect(
      jumiaConsignmentGetQuerySchema.safeParse({
        integrationId: 'bad',
        sku: '',
        businessClientCode: '',
      }).success
    ).toBe(false);
  });

  it('rejects invalid calendar dates and empty product lists', () => {
    expect(
      jumiaConsignmentCreateSchema.safeParse({
        integrationId,
        businessClientCode: 'NG',
        shippingDate: '2026-02-31',
        products: [],
      }).success
    ).toBe(false);
  });

  it('accepts update fields and rejects an invalid date', () => {
    expect(
      jumiaConsignmentUpdateSchema.safeParse({
        integrationId,
        purchaseOrderNumber: 'PO-1',
        isShipped: true,
        actualDepartureDate: '2026-08-31',
      }).success
    ).toBe(true);
    expect(
      jumiaConsignmentUpdateSchema.safeParse({
        integrationId,
        purchaseOrderNumber: 'PO-1',
        estimatedArrivalDate: '2026-02-31',
      }).success
    ).toBe(false);
  });
});
