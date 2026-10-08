import { describe, expect, it } from 'vitest';
import {
  buildTransactionDateIso,
  buildTransactionReviewRangeFilters,
  filterOrdersForTransactionTab,
  filterTransactionOrders,
  formatCostPriceInput,
  formatCostPriceInputText,
  formatTransactionDateInput,
  getSupplierNameFromMetadata,
  getSupplierOptionsFromOrders,
  mapTransactionOrderRows,
  parseCostPriceInput,
  splitTransactionSearchTerms,
  toSentenceCaseSupplierName,
} from './transaction-review';

describe('transaction review helpers', () => {
  it('maps paid order rows with supplier, IMEI, serial, and profit metadata', () => {
    const [order] = mapTransactionOrderRows([
      {
        created_at: '2026-05-11T12:30:00.000Z',
        transaction_date: '2026-05-10T12:30:00.000Z',
        customer_email: 'newton@example.com',
        customer_name: 'Newton Chiemelie',
        customer_phone: '08030000000',
        fulfillment_details: { serialNumber: 'ORDER-SN-1' },
        id: 'order-1',
        order_items: [
          {
            fulfillment_data: { imei: '353232106161443' },
            id: 'item-1',
            name: 'iPhone 11 Pro',
            price: 180_000,
            product_id: 'product-1',
            products: {
              cost_price: 120_000,
              fulfillment_details: { items: [] },
              metadata: { supplier_name: 'Slot Wholesale' },
              sku: 'IP11-PRO',
            },
            quantity: 1,
          },
        ],
        order_number: 'ORD-110526-74B115',
        payment_method: 'transfer',
        total: 180_000,
      },
    ]);

    expect(order).toMatchObject({
      createdAt: '2026-05-10T12:30:00.000Z',
      customerEmail: 'newton@example.com',
      customerName: 'Newton Chiemelie',
      customerPhone: '08030000000',
      estimatedProfit: 60_000,
      missingCostCount: 0,
      orderNumber: 'ORD-110526-74B115',
    });
    expect(order.items[0]).toMatchObject({
      costPrice: 120_000,
      imeiValues: ['353232106161443'],
      serialValues: ['ORDER-SN-1'],
      sku: 'IP11-PRO',
      supplierName: 'Slot Wholesale',
    });
    expect(order.searchText).toContain('newton chiemelie');
    expect(order.searchText).toContain('353232106161443');
    expect(order.searchText).toContain('slot wholesale');
  });

  it('uses item-level fulfillment identifiers without repeating unrelated order serials', () => {
    const [order] = mapTransactionOrderRows([
      {
        created_at: '2026-07-01T12:30:00.000Z',
        transaction_date: null,
        customer_email: null,
        customer_name: 'Kayode Omelehinwa',
        customer_phone: null,
        fulfillment_details: {
          serialNumber: 'LEGACY-ORDER-SN',
          items: [
            {
              id: 'item-laptop:1',
              orderItemId: 'item-laptop',
              serialNumber: 'LAPTOP-SN-1',
              unitIndex: 0,
            },
            {
              id: 'item-laptop:2',
              orderItemId: 'item-laptop',
              serialNumber: 'LAPTOP-SN-2',
              unitIndex: 1,
            },
            {
              id: 'item-buds:1',
              imei: '353456789012345',
              orderItemId: 'item-buds',
              unitIndex: 0,
            },
          ],
        },
        id: 'order-1',
        order_items: [
          {
            cost_price: 850_000,
            fulfillment_data: null,
            id: 'item-laptop',
            name: 'HP EliteBook x360 1040 G10',
            price: 900_000,
            product_id: 'product-laptop',
            product_variants: null,
            products: null,
            quantity: 2,
            supplier_name: 'Supplier A',
            variant_id: null,
          },
          {
            cost_price: 180_000,
            fulfillment_data: null,
            id: 'item-buds',
            name: 'Samsung Galaxy Buds4 Pro',
            price: 280_000,
            product_id: 'product-buds',
            product_variants: null,
            products: null,
            quantity: 1,
            supplier_name: 'Supplier B',
            variant_id: null,
          },
        ],
        order_number: 'ORD-010726-600DDC',
        payment_method: 'transfer',
        total: 2_080_000,
      },
    ]);

    expect(order.items).toMatchObject([
      {
        id: 'item-laptop:1',
        orderItemId: 'item-laptop',
        profit: 50_000,
        quantity: 1,
        revenue: 900_000,
        serialValues: ['LAPTOP-SN-1'],
      },
      {
        id: 'item-laptop:2',
        orderItemId: 'item-laptop',
        profit: 50_000,
        quantity: 1,
        revenue: 900_000,
        serialValues: ['LAPTOP-SN-2'],
      },
      {
        id: 'item-buds:1',
        imeiValues: ['353456789012345'],
        orderItemId: 'item-buds',
        profit: 100_000,
        quantity: 1,
        revenue: 280_000,
        serialValues: [],
      },
    ]);
    expect(order.items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ serialValues: ['LEGACY-ORDER-SN'] }),
      ])
    );
    expect(order.estimatedProfit).toBe(200_000);
    expect(order.searchText).toContain('laptop-sn-2');
    expect(order.searchText).toContain('353456789012345');
  });

  it('uses per-unit transaction costs and suppliers when they exist', () => {
    const [order] = mapTransactionOrderRows([
      {
        created_at: '2026-07-01T12:30:00.000Z',
        transaction_date: null,
        customer_email: null,
        customer_name: 'Kayode Omelehinwa',
        customer_phone: null,
        fulfillment_details: {
          items: [
            {
              id: 'item-laptop:1',
              orderItemId: 'item-laptop',
              serialNumber: 'LAPTOP-SN-1',
              unitIndex: 0,
            },
            {
              id: 'item-laptop:2',
              orderItemId: 'item-laptop',
              serialNumber: 'LAPTOP-SN-2',
              unitIndex: 1,
            },
          ],
        },
        id: 'order-1',
        order_items: [
          {
            cost_price: 850_000,
            fulfillment_data: null,
            id: 'item-laptop',
            name: 'HP EliteBook x360 1040 G10',
            order_item_unit_costs: [
              {
                cost_price: 800_000,
                identifier_type: 'serial',
                identifier_value: 'LAPTOP-SN-1',
                supplier_name: 'Supplier A',
                unit_index: 0,
              },
              {
                cost_price: 870_000,
                identifier_type: 'serial',
                identifier_value: 'LAPTOP-SN-2',
                supplier_name: 'Supplier B',
                unit_index: 1,
              },
            ],
            price: 900_000,
            product_id: 'product-laptop',
            product_variants: null,
            products: null,
            quantity: 2,
            supplier_name: 'Fallback Supplier',
            variant_id: null,
          },
        ],
        order_number: 'ORD-010726-600DDC',
        payment_method: 'transfer',
        total: 1_800_000,
      },
    ]);

    expect(order.items).toMatchObject([
      {
        costPrice: 800_000,
        costSource: 'unit',
        orderItemId: 'item-laptop',
        profit: 100_000,
        serialValues: ['LAPTOP-SN-1'],
        supplierName: 'Supplier A',
        unitIndex: 0,
      },
      {
        costPrice: 870_000,
        costSource: 'unit',
        orderItemId: 'item-laptop',
        profit: 30_000,
        serialValues: ['LAPTOP-SN-2'],
        supplierName: 'Supplier B',
        unitIndex: 1,
      },
    ]);
    expect(order.estimatedProfit).toBe(130_000);
    expect(getSupplierOptionsFromOrders([order])).toEqual([
      'Supplier a',
      'Supplier b',
    ]);
  });

  it('keeps unrecorded units of a multi-unit line when only one has a cost', () => {
    // Only unit 0 has a per-unit cost; unit 1 must still appear (falling back to
    // the order-item cost) so profit/missing-cost totals count both units.
    const [order] = mapTransactionOrderRows([
      {
        created_at: '2026-07-01T12:30:00.000Z',
        transaction_date: null,
        customer_email: null,
        customer_name: 'Partial Units',
        customer_phone: null,
        fulfillment_details: null,
        id: 'order-1',
        order_items: [
          {
            cost_price: 850_000,
            fulfillment_data: null,
            id: 'item-laptop',
            name: 'HP EliteBook',
            order_item_unit_costs: [
              {
                cost_price: 800_000,
                identifier_type: 'serial',
                identifier_value: 'LAPTOP-SN-1',
                supplier_name: 'Supplier A',
                unit_index: 0,
              },
            ],
            price: 900_000,
            product_id: 'product-laptop',
            product_variants: null,
            products: null,
            quantity: 2,
            supplier_name: 'Fallback Supplier',
            variant_id: null,
          },
        ],
        order_number: 'ORD-010726-PARTIAL',
        payment_method: 'transfer',
        total: 1_800_000,
      },
    ]);

    expect(order.items).toMatchObject([
      { costPrice: 800_000, costSource: 'unit', profit: 100_000, unitIndex: 0 },
      {
        costPrice: 850_000,
        costSource: 'order_item',
        profit: 50_000,
        unitIndex: 1,
      },
    ]);
    expect(order.missingCostCount).toBe(0);
    expect(order.estimatedProfit).toBe(150_000);
  });

  it('keeps stale out-of-range unit costs visible without counting them in totals', () => {
    const [order] = mapTransactionOrderRows([
      {
        created_at: '2026-07-01T12:30:00.000Z',
        transaction_date: null,
        customer_email: null,
        customer_name: 'Stale Unit Customer',
        customer_phone: null,
        fulfillment_details: null,
        id: 'order-1',
        order_items: [
          {
            cost_price: 850_000,
            fulfillment_data: null,
            id: 'item-laptop',
            name: 'HP EliteBook',
            order_item_unit_costs: [
              {
                cost_price: 800_000,
                identifier_type: 'serial',
                identifier_value: 'STALE-SN-5',
                supplier_name: 'Stale Supplier',
                unit_index: 5,
              },
            ],
            price: 900_000,
            product_id: 'product-laptop',
            product_variants: null,
            products: null,
            quantity: 2,
            supplier_name: 'Fallback Supplier',
            variant_id: null,
          },
        ],
        order_number: 'ORD-010726-STALE',
        payment_method: 'transfer',
        total: 1_800_000,
      },
    ]);

    expect(order.items).toMatchObject([
      {
        costPrice: 850_000,
        costSource: 'order_item',
        profit: 50_000,
        quantity: 1,
        revenue: 900_000,
        unitIndex: 0,
      },
      {
        costPrice: 850_000,
        costSource: 'order_item',
        profit: 50_000,
        quantity: 1,
        revenue: 900_000,
        unitIndex: 1,
      },
      {
        costPrice: 800_000,
        costSource: 'unit',
        identifierValue: 'STALE-SN-5',
        profit: 0,
        quantity: 0,
        revenue: 0,
        supplierName: 'Stale Supplier',
        unitIndex: 5,
      },
    ]);
    expect(order.estimatedProfit).toBe(100_000);
    expect(order.searchText).toContain('stale-sn-5');
  });

  it('does not copy item-level identifiers into synthesized unit rows', () => {
    const [order] = mapTransactionOrderRows([
      {
        created_at: '2026-07-01T12:30:00.000Z',
        transaction_date: null,
        customer_email: null,
        customer_name: 'Split Units',
        customer_phone: null,
        fulfillment_details: null,
        id: 'order-1',
        order_items: [
          {
            cost_price: 850_000,
            fulfillment_data: {
              imei: 'ITEM-LEVEL-IMEI',
              serialNumber: 'ITEM-LEVEL-SERIAL',
            },
            id: 'item-laptop',
            name: 'HP EliteBook',
            order_item_unit_costs: [
              {
                cost_price: 800_000,
                identifier_type: 'serial',
                identifier_value: 'LAPTOP-SN-1',
                supplier_name: 'Supplier A',
                unit_index: 0,
              },
            ],
            price: 900_000,
            product_id: 'product-laptop',
            product_variants: null,
            products: null,
            quantity: 2,
            supplier_name: 'Fallback Supplier',
            variant_id: null,
          },
        ],
        order_number: 'ORD-010726-SPLIT',
        payment_method: 'transfer',
        total: 1_800_000,
      },
    ]);

    expect(order.items).toMatchObject([
      {
        identifierType: 'serial',
        identifierValue: 'LAPTOP-SN-1',
        imeiValues: [],
        serialValues: ['LAPTOP-SN-1'],
        unitIndex: 0,
      },
      {
        identifierType: null,
        identifierValue: null,
        imeiValues: [],
        serialValues: [],
        unitIndex: 1,
      },
    ]);
  });

  it('uses order item cost and supplier before product defaults', () => {
    // Arrange
    const rows = [
      {
        created_at: '2026-05-11T12:30:00.000Z',
        transaction_date: null,
        customer_email: null,
        customer_name: 'Olayinka Akerele',
        customer_phone: null,
        fulfillment_details: null,
        id: 'order-1',
        order_items: [
          {
            cost_price: 150_000,
            fulfillment_data: { imei: '353232106161443' },
            id: 'item-1',
            name: 'iPhone 11 Pro 64gb Premium Used',
            price: 180_000,
            product_id: null,
            product_variants: null,
            products: null,
            quantity: 1,
            supplier_name: 'Used Phone Supplier',
            variant_id: null,
          },
        ],
        order_number: 'ORD-110526-74B115',
        payment_method: 'transfer',
        total: 180_000,
      },
    ];

    // Act
    const [order] = mapTransactionOrderRows([...rows]);

    // Assert
    expect(order.missingCostCount).toBe(0);
    expect(order.estimatedProfit).toBe(30_000);
    expect(order.items[0]).toMatchObject({
      costPrice: 150_000,
      costSource: 'order_item',
      productId: null,
      supplierName: 'Used Phone Supplier',
    });
  });

  it('preserves order item product match status for reconciliation entry points', () => {
    // Arrange
    const rows = [
      {
        created_at: '2026-05-11T12:30:00.000Z',
        transaction_date: null,
        customer_email: null,
        customer_name: 'Custom Customer',
        customer_phone: null,
        fulfillment_details: null,
        id: 'order-1',
        order_items: [
          {
            fulfillment_data: null,
            id: 'item-1',
            name: 'Itel Buds Neo 3',
            price: 20_000,
            product_id: null,
            product_match_status: 'custom' as const,
            product_variants: null,
            products: null,
            quantity: 1,
            variant_id: null,
          },
        ],
        order_number: 'ORD-CUSTOM',
        payment_method: 'transfer',
        total: 20_000,
      },
    ];

    // Act
    const [order] = mapTransactionOrderRows([...rows]);

    // Assert
    expect(order.items[0]?.productMatchStatus).toBe('custom');
  });

  it('falls back to product cost and supplier when the order item has no override', () => {
    // Arrange
    const rows = [
      {
        created_at: '2026-05-11T12:30:00.000Z',
        transaction_date: null,
        customer_email: null,
        customer_name: 'Newton Chiemelie',
        customer_phone: null,
        fulfillment_details: null,
        id: 'order-1',
        order_items: [
          {
            cost_price: null,
            fulfillment_data: null,
            id: 'item-1',
            name: 'Redmi 15 8GB 256GB',
            price: 200_000,
            product_id: 'product-1',
            product_variants: null,
            products: {
              cost_price: 180_000,
              fulfillment_details: null,
              metadata: { supplier_name: 'Catalog Supplier' },
              sku: null,
            },
            quantity: 1,
            supplier_name: null,
            variant_id: null,
          },
        ],
        order_number: 'ORD-110526-38F265',
        payment_method: 'transfer',
        total: 200_000,
      },
    ];

    // Act
    const [order] = mapTransactionOrderRows([...rows]);

    // Assert
    expect(order.items[0]).toMatchObject({
      costPrice: 180_000,
      costSource: 'product',
      supplierName: 'Catalog Supplier',
    });
  });

  it('falls back to variant cost before product cost', () => {
    // Arrange
    const rows = [
      {
        created_at: '2026-05-11T12:30:00.000Z',
        transaction_date: null,
        customer_email: null,
        customer_name: 'Variant Customer',
        customer_phone: null,
        fulfillment_details: null,
        id: 'order-1',
        order_items: [
          {
            cost_price: null,
            fulfillment_data: null,
            id: 'item-1',
            name: 'iPhone 11 Pro',
            price: 180_000,
            product_id: 'product-1',
            product_variants: {
              attributes: { storage: '64GB' },
              condition: 'used',
              cost_price: 150_000,
              sku: 'IPH-11P-64-PU',
            },
            products: {
              cost_price: 220_000,
              fulfillment_details: null,
              metadata: { supplier_name: 'Catalog Supplier' },
              sku: 'IPH-11P',
            },
            quantity: 1,
            supplier_name: null,
            variant_id: 'variant-1',
          },
        ],
        order_number: 'ORD-VARIANT',
        payment_method: 'transfer',
        total: 180_000,
      },
    ];

    // Act
    const [order] = mapTransactionOrderRows([...rows]);

    // Assert
    expect(order.items[0]).toMatchObject({
      costPrice: 150_000,
      costSource: 'variant',
      productId: 'product-1',
      variantId: 'variant-1',
    });
  });

  it('treats malformed numeric payloads as missing costs instead of NaN', () => {
    // Arrange
    const rows = [
      {
        created_at: '2026-05-11T12:30:00.000Z',
        transaction_date: null,
        customer_email: null,
        customer_name: 'Malformed Customer',
        customer_phone: null,
        fulfillment_details: null,
        id: 'order-1',
        order_items: [
          {
            cost_price: 'not-a-cost',
            fulfillment_data: null,
            id: 'item-1',
            name: 'Malformed Item',
            price: 'not-a-price',
            product_id: 'product-1',
            product_variants: {
              attributes: null,
              condition: null,
              cost_price: 'bad-variant-cost',
              sku: null,
            },
            products: {
              cost_price: 'bad-product-cost',
              fulfillment_details: null,
              metadata: null,
              sku: null,
            },
            quantity: 'not-a-quantity',
            supplier_name: null,
            variant_id: 'variant-1',
          },
        ],
        order_number: 'ORD-MALFORMED',
        payment_method: 'transfer',
        total: 'not-a-total',
      },
    ] as unknown as Parameters<typeof mapTransactionOrderRows>[0];

    // Act
    const [order] = mapTransactionOrderRows(rows);

    // Assert
    expect(order.total).toBe(0);
    expect(order.estimatedProfit).toBe(0);
    expect(order.missingCostCount).toBe(1);
    expect(order.items[0]).toMatchObject({
      costPrice: null,
      costSource: null,
      profit: null,
      quantity: 1,
      revenue: 0,
    });
  });

  it('filters transactions by order, customer, supplier, IMEI, or serial text', () => {
    const orders = mapTransactionOrderRows([
      {
        created_at: '2026-05-11T12:30:00.000Z',
        transaction_date: null,
        customer_email: null,
        customer_name: 'Newton Chiemelie',
        customer_phone: null,
        fulfillment_details: null,
        id: 'order-1',
        order_items: [
          {
            fulfillment_data: { imei: '353232106161443' },
            id: 'item-1',
            name: 'iPhone 11 Pro',
            price: 180_000,
            product_id: 'product-1',
            products: {
              cost_price: null,
              fulfillment_details: null,
              metadata: { vendor_name: 'Ogabassey Supplier' },
              sku: 'IP11-PRO',
            },
            quantity: 1,
          },
        ],
        order_number: 'ORD-110526-74B115',
        payment_method: 'transfer',
        total: 180_000,
      },
      {
        created_at: '2026-05-09T12:30:00.000Z',
        transaction_date: null,
        customer_email: null,
        customer_name: 'Efosa Igbinovia',
        customer_phone: null,
        fulfillment_details: { serial_number: 'SN-EFOSA-9' },
        id: 'order-2',
        order_items: [],
        order_number: 'ORD-260509-00NV-R',
        payment_method: 'bank_transfer',
        total: 835_000,
      },
    ]);

    expect(filterTransactionOrders(orders, '353232106161443')).toHaveLength(1);
    expect(filterTransactionOrders(orders, 'ogabassey supplier')).toHaveLength(
      1
    );
    expect(filterTransactionOrders(orders, 'SN-EFOSA-9')[0]?.orderNumber).toBe(
      'ORD-260509-00NV-R'
    );
    expect(filterTransactionOrders(orders, 'missing text')).toEqual([]);
  });

  it('splits search queries into terms for server and client matching', () => {
    expect(splitTransactionSearchTerms(' 353232106161443  Ada ')).toEqual([
      '353232106161443',
      'Ada',
    ]);
    expect(splitTransactionSearchTerms('   ')).toEqual([]);
  });

  it('filters the missing-cost tab down to only missing-cost line items', () => {
    const orders = mapTransactionOrderRows([
      {
        created_at: '2026-05-11T12:30:00.000Z',
        transaction_date: null,
        customer_email: null,
        customer_name: 'Mixed Customer',
        customer_phone: null,
        fulfillment_details: null,
        id: 'order-1',
        order_items: [
          {
            fulfillment_data: null,
            id: 'item-known',
            name: 'Known Cost',
            price: 5000,
            product_id: 'product-1',
            products: {
              cost_price: 3000,
              fulfillment_details: null,
              metadata: null,
              sku: null,
            },
            quantity: 1,
          },
          {
            fulfillment_data: null,
            id: 'item-missing',
            name: 'Missing Cost',
            price: 4000,
            product_id: 'product-2',
            products: {
              cost_price: null,
              fulfillment_details: null,
              metadata: null,
              sku: null,
            },
            quantity: 1,
          },
        ],
        order_number: 'ORD-MIXED',
        payment_method: 'transfer',
        total: 9000,
      },
    ]);

    expect(
      filterOrdersForTransactionTab(orders, 'paid')[0]?.items
    ).toHaveLength(2);
    expect(filterOrdersForTransactionTab(orders, 'missing-costs')).toEqual([
      expect.objectContaining({
        items: [expect.objectContaining({ id: 'item-missing' })],
        missingCostCount: 1,
        orderNumber: 'ORD-MIXED',
      }),
    ]);
  });

  it('formats and parses currency cost price input', () => {
    expect(formatCostPriceInput(null, '₦')).toBe('');
    expect(formatCostPriceInput(1200, '₦')).toBe('₦1,200');
    expect(formatCostPriceInput(1200.5, '₦')).toBe('₦1,200.5');
    expect(formatCostPriceInputText('1200000.50', '₦')).toBe('₦1,200,000.50');
    expect(formatCostPriceInputText('₦1,200,000.50', '₦')).toBe(
      '₦1,200,000.50'
    );
    expect(parseCostPriceInput('₦1,200,000.50')).toBe(1_200_000.5);
    expect(Number.isNaN(parseCostPriceInput('₦'))).toBe(true);
  });

  it('sentence-cases supplier names and derives unique previous suppliers', () => {
    const orders = mapTransactionOrderRows([
      {
        created_at: '2026-05-11T12:30:00.000Z',
        transaction_date: null,
        customer_email: null,
        customer_name: 'Supplier Customer',
        customer_phone: null,
        fulfillment_details: null,
        id: 'order-1',
        order_items: [
          {
            fulfillment_data: null,
            id: 'item-1',
            name: 'Supplier Item',
            price: 5000,
            product_id: 'product-1',
            products: {
              cost_price: null,
              fulfillment_details: null,
              metadata: { supplier_name: 'SLOT WHOLESALE' },
              sku: null,
            },
            quantity: 1,
          },
          {
            fulfillment_data: null,
            id: 'item-2',
            name: 'Supplier Item 2',
            price: 6000,
            product_id: 'product-2',
            products: {
              cost_price: null,
              fulfillment_details: null,
              metadata: { vendor_name: 'slot wholesale' },
              sku: null,
            },
            quantity: 1,
          },
        ],
        order_number: 'ORD-SUPPLIER',
        payment_method: 'transfer',
        total: 11_000,
      },
    ]);

    expect(toSentenceCaseSupplierName('  MAIN SUPPLIER ltd  ')).toBe(
      'Main supplier ltd'
    );
    expect(getSupplierOptionsFromOrders(orders)).toEqual(['Slot wholesale']);
  });

  it('builds range filters that fall back to created_at for historical rows', () => {
    expect(buildTransactionReviewRangeFilters(undefined, undefined)).toEqual({
      endDateFilter: undefined,
      startDateFilter: undefined,
    });
    expect(
      buildTransactionReviewRangeFilters('2026-05-01T00:00:00.000Z', undefined)
    ).toEqual({
      endDateFilter: undefined,
      startDateFilter:
        'transaction_date.gte.2026-05-01T00:00:00.000Z,and(transaction_date.is.null,created_at.gte.2026-05-01T00:00:00.000Z)',
    });
    expect(
      buildTransactionReviewRangeFilters(undefined, '2026-05-31T23:59:59.999Z')
    ).toEqual({
      endDateFilter:
        'transaction_date.lte.2026-05-31T23:59:59.999Z,and(transaction_date.is.null,created_at.lte.2026-05-31T23:59:59.999Z)',
      startDateFilter: undefined,
    });
    expect(
      buildTransactionReviewRangeFilters(
        '2026-05-01T00:00:00.000Z',
        '2026-05-31T23:59:59.999Z'
      )
    ).toEqual({
      endDateFilter:
        'transaction_date.lte.2026-05-31T23:59:59.999Z,and(transaction_date.is.null,created_at.lte.2026-05-31T23:59:59.999Z)',
      startDateFilter:
        'transaction_date.gte.2026-05-01T00:00:00.000Z,and(transaction_date.is.null,created_at.gte.2026-05-01T00:00:00.000Z)',
    });
  });

  it('normalizes supplier and date edits', () => {
    expect(
      getSupplierNameFromMetadata({ supplier: ' Tech Distributors ' })
    ).toBe('Tech Distributors');
    expect(getSupplierNameFromMetadata(null)).toBe('');
    expect(getSupplierNameFromMetadata(undefined)).toBe('');
    expect(getSupplierNameFromMetadata({ color: 'black' })).toBe('');
    expect(formatTransactionDateInput('2026-05-11T12:30:00.000Z')).toBe(
      '2026-05-11'
    );
    expect(formatTransactionDateInput('not-a-date')).toBe('');
    const previousTimeZone = process.env.TZ;
    process.env.TZ = 'UTC';

    try {
      expect(buildTransactionDateIso('2026-05-12')).toBe(
        '2026-05-12T00:00:00.000Z'
      );
    } finally {
      if (previousTimeZone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTimeZone;
      }
    }

    expect(buildTransactionDateIso('05-12-2026')).toBeNull();
    expect(buildTransactionDateIso('2026-02-31')).toBeNull();
  });

  it('keeps the same local calendar day for negative-offset timezones', () => {
    const previousTimeZone = process.env.TZ;
    process.env.TZ = 'America/New_York';

    try {
      const iso = buildTransactionDateIso('2026-05-13');

      expect(iso).toBe('2026-05-13T04:00:00.000Z');
      expect(formatTransactionDateInput(iso ?? '')).toBe('2026-05-13');
    } finally {
      if (previousTimeZone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTimeZone;
      }
    }
  });

  it('formats transaction date inputs using the local calendar day', () => {
    const previousTimeZone = process.env.TZ;
    process.env.TZ = 'Africa/Lagos';

    try {
      expect(formatTransactionDateInput('2026-05-12T23:30:00.000Z')).toBe(
        '2026-05-13'
      );
    } finally {
      if (previousTimeZone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTimeZone;
      }
    }
  });

  it('maps edge cases for nullable items, product arrays, and fallback labels', () => {
    const [emptyOrder, mixedOrder] = mapTransactionOrderRows([
      {
        created_at: '2026-05-11T12:30:00.000Z',
        transaction_date: null,
        customer_email: null,
        customer_name: null,
        customer_phone: null,
        fulfillment_details: null,
        id: 'order-with-long-id',
        order_items: null,
        order_number: null,
        payment_method: null,
        total: null,
      },
      {
        created_at: '2026-05-12T12:30:00.000Z',
        transaction_date: '2026-05-13T12:30:00.000Z',
        customer_email: null,
        customer_name: 'Mixed Customer',
        customer_phone: null,
        fulfillment_details: null,
        id: 'order-2',
        order_items: [
          {
            fulfillment_data: null,
            id: 'item-1',
            name: 'Known Cost',
            price: 5000,
            product_id: 'product-1',
            products: [
              {
                cost_price: 2500,
                fulfillment_details: null,
                metadata: null,
                sku: 'KNOWN',
              },
            ],
            quantity: 2,
          },
          {
            fulfillment_data: null,
            id: 'item-2',
            name: 'Missing Cost',
            price: 4000,
            product_id: 'product-2',
            products: {
              cost_price: null,
              fulfillment_details: null,
              metadata: null,
              sku: null,
            },
            quantity: 1,
          },
        ],
        order_number: 'ORD-MIXED',
        payment_method: 'transfer',
        total: 14_000,
      },
    ]);

    expect(emptyOrder).toMatchObject({
      createdAt: '2026-05-11T12:30:00.000Z',
      customerName: 'Customer',
      items: [],
      missingCostCount: 0,
      orderNumber: 'order-wi',
      paymentMethod: 'unknown',
      total: 0,
    });
    expect(mixedOrder).toMatchObject({
      createdAt: '2026-05-13T12:30:00.000Z',
      estimatedProfit: 5000,
      missingCostCount: 1,
      orderNumber: 'ORD-MIXED',
    });
  });
});
