import { beforeEach, describe, expect, it } from 'vitest';
import {
  fetchOrderByIdForTest as fetchOrderById,
  orderDetailsTestMocks,
  resetOrderDetailsMocks,
} from './useOrderDetails.test-support';

const { supabaseMock } = orderDetailsTestMocks;

describe('fetchOrderById core details', () => {
  beforeEach(resetOrderDetailsMocks);

  it('applies branch scope when fetching a single order by id', async () => {
    await fetchOrderById('order-1', 'merchant-1', {
      type: 'branch',
      branchId: 'branch-1',
    });

    const orderQuery = supabaseMock.chains.find(
      (chain) => chain.table === 'orders'
    );

    expect(orderQuery?.calls).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['id', 'order-1'] },
        { method: 'eq', args: ['merchant_id', 'merchant-1'] },
        { method: 'eq', args: ['branch_id', 'branch-1'] },
      ])
    );
  });

  it('returns calculated payment metadata and mapped order items', async () => {
    supabaseMock.setOrderDetailResult({
      data: {
        id: 'order-1',
        recorded_by_user_id: null,
        total: 100,
        wallet_amount_used: 20,
      },
      error: null,
    });
    supabaseMock.setTableResult('order_items', {
      data: [
        {
          id: 'item-1',
          condition: 'open_box',
          has_assurance: true,
          image_url: 'https://example.test/order-snapshot.jpg',
          item_description: 'Battery health 89%',
          product_id: 'product-1',
          product_match_status: 'linked',
          variant_attributes: { color: 'Blue', storage: '512GB' },
          variant_id: 'variant-1',
          variant_name: 'Blue',
          name: null,
          quantity: 2,
          price: 25,
          products: {
            categories: {
              name: 'Smartphones',
              slug: 'smartphones',
            },
            category: 'Smartphones',
            category_id: 'category-1',
            condition: 'new',
            images: ['https://example.test/image.jpg'],
            name: 'Phone',
          },
        },
      ],
      error: null,
    });
    supabaseMock.setTableResult('transactions', {
      data: [{ amount: 15, transaction_type: 'payment' }],
      error: null,
    });
    supabaseMock.setTableResult('order_payment_accounts', {
      data: [
        {
          account_name: 'Legacy Store',
          account_number: '0987654321',
          bank_name: 'Kora Bank',
          provider: 'korapay',
          created_at: '2026-08-24T12:00:00.000Z',
        },
        {
          account_name: 'Baci Store',
          account_number: '1234567890',
          bank_name: 'Paystack-Titan',
          provider: 'paystack',
          created_at: new Date().toISOString(),
        },
      ],
      error: null,
    });

    await expect(fetchOrderById('order-1', 'merchant-1')).resolves.toEqual(
      expect.objectContaining({
        amount_paid: 35,
        balance: 65,
        virtual_account: expect.objectContaining({
          account_name: 'Baci Store',
          account_number: '1234567890',
          bank_name: 'Paystack-Titan',
        }),
        items: [
          expect.objectContaining({
            id: 'item-1',
            category: 'Smartphones',
            category_slug: 'smartphones',
            condition: 'open_box',
            details: 'Battery health 89%',
            image_url: 'https://example.test/order-snapshot.jpg',
            name: 'Phone',
            product_name: 'Phone',
            product_match_status: 'linked',
            quantity: 2,
            variant_attributes: { color: 'Blue', storage: '512GB' },
            variant_id: 'variant-1',
            variant_name: 'Blue',
          }),
        ],
      })
    );

    const transactionQuery = supabaseMock.chains.find(
      (chain) => chain.table === 'transactions'
    );
    expect(transactionQuery?.calls).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['order_id', 'order-1'] },
        { method: 'eq', args: ['merchant_id', 'merchant-1'] },
        { method: 'eq', args: ['transaction_type', 'payment'] },
        { method: 'in', args: ['status', ['success', 'completed']] },
      ])
    );
  });
});
