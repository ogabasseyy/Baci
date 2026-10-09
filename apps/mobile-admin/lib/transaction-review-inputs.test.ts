import { describe, expect, it } from 'vitest';
import {
  filterOrdersForTransactionTab,
  formatCostPriceInput,
  formatCostPriceInputText,
  formatPickerDateInput,
  getSupplierOptionsFromOrders,
  parseCostPriceInput,
  parseDateInputForPicker,
  toSentenceCaseSupplierName,
} from './transaction-review-inputs';
import type { TransactionReviewOrder } from './transaction-review-types';

const baseOrder: Omit<TransactionReviewOrder, 'items' | 'missingCostCount'> = {
  createdAt: '2026-05-11T12:30:00.000Z',
  customerEmail: null,
  customerName: 'Customer',
  customerPhone: null,
  estimatedProfit: 1000,
  id: 'order-1',
  orderNumber: 'ORD-1',
  paymentMethod: 'transfer',
  searchText: 'ord-1 customer',
  total: 9000,
};

describe('transaction review input helpers', () => {
  it('formats and parses currency cost price text', () => {
    expect(formatCostPriceInput(null, '₦')).toBe('');
    expect(formatCostPriceInput(1200, '₦')).toBe('₦1,200');
    expect(formatCostPriceInput(-1200, '₦')).toBe('-₦1,200');
    expect(formatCostPriceInputText('12,5', '₦')).toBe('₦125');
    expect(formatCostPriceInputText(',5', '₦')).toBe('₦5');
    expect(formatCostPriceInputText('1,200', '₦')).toBe('₦1,200');
    expect(formatCostPriceInputText('₦1,2345', '₦')).toBe('₦12,345');
    expect(formatCostPriceInputText('₦1,23', '₦')).toBe('₦123');
    expect(formatCostPriceInputText('1200000.50', '₦')).toBe('₦1,200,000.50');
    expect(formatCostPriceInputText('-1200', '₦')).toBe('-₦1,200');
    expect(parseCostPriceInput('₦1,200,000.50')).toBe(1_200_000.5);
    expect(parseCostPriceInput('₦12,5')).toBe(125);
    expect(parseCostPriceInput('₦,5')).toBe(5);
    expect(parseCostPriceInput('₦1,200')).toBe(1200);
    expect(parseCostPriceInput('₦1-200')).toBe(1200);
    expect(parseCostPriceInput('-₦1,200')).toBe(-1200);
    expect(parseCostPriceInput('₦-1,200')).toBe(-1200);
    expect(Number.isNaN(parseCostPriceInput('₦'))).toBe(true);
  });

  it('formats local picker dates for transaction date input fields', () => {
    expect(formatPickerDateInput(new Date(2026, 4, 14))).toBe('2026-05-14');
    expect(parseDateInputForPicker('2026-05-14').getFullYear()).toBe(2026);
    expect(parseDateInputForPicker('bad-date').getTime()).not.toBeNaN();
  });

  it('sentence-cases suppliers and filters missing-cost tab line items', () => {
    const orders: TransactionReviewOrder[] = [
      {
        ...baseOrder,
        items: [
          {
            costPrice: 3000,
            costSource: 'product',
            id: 'item-known',
            imeiValues: [],
            name: 'Known Cost',
            productId: 'product-1',
            productMatchStatus: 'linked',
            profit: 2000,
            quantity: 1,
            revenue: 5000,
            searchText: 'known cost',
            serialValues: [],
            sku: null,
            supplierName: 'SLOT WHOLESALE',
            variantId: null,
          },
          {
            costPrice: null,
            costSource: null,
            id: 'item-missing',
            imeiValues: [],
            name: 'Missing Cost',
            productId: 'product-2',
            productMatchStatus: 'linked',
            profit: null,
            quantity: 1,
            revenue: 4000,
            searchText: 'missing cost',
            serialValues: [],
            sku: null,
            supplierName: 'slot wholesale',
            variantId: null,
          },
        ],
        missingCostCount: 1,
      },
    ];

    expect(toSentenceCaseSupplierName('  MAIN SUPPLIER ltd  ')).toBe(
      'Main supplier ltd'
    );
    expect(getSupplierOptionsFromOrders(orders)).toEqual(['Slot wholesale']);
    expect(filterOrdersForTransactionTab(orders, 'missing-costs')).toEqual([
      expect.objectContaining({
        items: [expect.objectContaining({ id: 'item-missing' })],
        missingCostCount: 1,
      }),
    ]);
  });

  it('preserves order-level tokens in the missing-costs search text', () => {
    const [filtered] = filterOrdersForTransactionTab(
      [
        {
          ...baseOrder,
          detailTokens: ['fragile'],
          items: [
            {
              costPrice: null,
              costSource: null,
              id: 'item-missing',
              imeiValues: [],
              name: 'Missing Cost',
              productId: null,
              productMatchStatus: 'unreviewed',
              profit: null,
              quantity: 1,
              revenue: 9000,
              searchText: 'missing cost',
              serialValues: [],
              sku: null,
              supplierName: 'Test Supplier',
              variantId: null,
            },
          ],
          missingCostCount: 1,
        },
      ],
      'missing-costs'
    );

    // The server matches id/total/date/details, so refinement must keep
    // them or server candidates waste the tab paging budget.
    expect(filtered.searchText).toContain('order-1');
    expect(filtered.searchText).toContain('9000');
    expect(filtered.searchText).toContain('2026-05-11t12:30:00.000z');
    expect(filtered.searchText).toContain('fragile');
    expect(filtered.searchText).toContain('missing cost');
  });
});
