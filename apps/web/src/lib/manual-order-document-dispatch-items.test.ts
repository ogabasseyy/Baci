import { describe, expect, it } from 'vitest';
import { projectDispatchSnapshotItems } from './manual-order-document-dispatch-items';

describe('projectDispatchSnapshotItems', () => {
  it('sorts by id and projects the RPC-compared key set', () => {
    const items = projectDispatchSnapshotItems([
      {
        id: 'item-b',
        name: 'B',
        quantity: 1,
        price: 50,
        variant_name: null,
        condition: null,
        item_description: null,
      },
      {
        id: 'item-a',
        name: 'A',
        quantity: 2,
        price: 100,
        variant_name: 'v',
        condition: 'new',
        item_description: 'Sealed',
        assurance_fee: 15000,
        line_id: 3,
        unit_code: 'EA',
        line_extension_amount: 190,
        vat_category_code: 'S',
        vat_rate: 7.5,
        vat_amount: 14.25,
        sellers_item_id: 'SKU-A',
      },
    ]);

    expect(items.map((item) => item.id)).toEqual(['item-a', 'item-b']);
    expect(items[0]).toEqual({
      id: 'item-a',
      name: 'A',
      quantity: 2,
      price: 100,
      variant_name: 'v',
      condition: 'new',
      item_description: 'Sealed',
      assurance_fee: 15000,
      line_id: 3,
      unit_code: 'EA',
      line_extension_amount: 190,
      vat_category_code: 'S',
      vat_rate: 7.5,
      vat_amount: 14.25,
      sellers_item_id: 'SKU-A',
    });
    // Missing keys normalize to null to match server NULLs.
    expect(items[1]).toMatchObject({ line_id: null, sellers_item_id: null });
  });
});
