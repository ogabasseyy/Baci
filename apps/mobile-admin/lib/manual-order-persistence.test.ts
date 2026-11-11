// @vitest-environment jsdom

import { PostgrestError } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createManualOrderWithItems } from '@/lib/manual-order-persistence';

function createPostgrestError(message: string) {
  return new PostgrestError({
    message,
    details: '',
    hint: '',
    code: 'PGRST204',
  });
}

const orderPayload = {
  merchant_id: 'merchant_1',
  customer_id: 'customer_1',
  order_number: 'ORD-130426-TEST01',
  customer_name: 'Funmilola Dada',
  total: 486438,
};

function buildItems(orderId: string) {
  return [
    {
      order_id: orderId,
      product_id: 'product_1',
      variant_id: 'variant_1',
      variant_name: 'iPhone 12 128GB · Used',
      name: 'iPhone 12 128GB',
      quantity: 1,
      price: 280000,
      condition: 'premium_used',
      item_description: 'Battery health 89%',
      product_match_status: 'linked' as const,
      variant_attributes: { color: 'Black', storage: '128GB' },
    },
  ];
}

function createDependencies(options?: {
  deleteOrderError?: PostgrestError | null;
  insertOrderError?: PostgrestError | null;
  insertOrderItemsResults?: Array<{ error: PostgrestError | null }>;
}) {
  const insertOrder = vi.fn().mockResolvedValue({
    data: options?.insertOrderError ? null : { id: 'order_1' },
    error: options?.insertOrderError ?? null,
  });
  const insertOrderItems = vi.fn().mockImplementation(() => {
    const nextResult = options?.insertOrderItemsResults?.shift();
    return Promise.resolve(nextResult ?? { error: null });
  });
  const deleteOrder = vi.fn().mockResolvedValue({
    error: options?.deleteOrderError ?? null,
  });

  return {
    deleteOrder,
    insertOrder,
    insertOrderItems,
  };
}

describe('createManualOrderWithItems', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates the order and items without rollback when inserts succeed', async () => {
    const dependencies = createDependencies();

    const result = await createManualOrderWithItems(dependencies, {
      order: orderPayload,
      buildItems,
    });

    expect(result).toEqual({ id: 'order_1' });
    expect(dependencies.insertOrder).toHaveBeenCalledWith(orderPayload);
    expect(dependencies.insertOrderItems).toHaveBeenCalledTimes(1);
    expect(dependencies.insertOrderItems).toHaveBeenCalledWith(
      buildItems('order_1')
    );
    expect(dependencies.deleteOrder).not.toHaveBeenCalled();
  });

  it('normalizes missing variant attributes before inserting items', async () => {
    const dependencies = createDependencies();

    await createManualOrderWithItems(dependencies, {
      order: orderPayload,
      buildItems: (orderId) => [
        {
          order_id: orderId,
          product_id: null,
          variant_id: null,
          variant_name: null,
          name: 'Custom phone case',
          quantity: 1,
          price: 5000,
          product_match_status: 'custom' as const,
          variant_attributes: null,
        },
      ],
    });

    expect(dependencies.insertOrderItems).toHaveBeenCalledWith([
      {
        order_id: 'order_1',
        product_id: null,
        variant_id: null,
        variant_name: null,
        name: 'Custom phone case',
        quantity: 1,
        price: 5000,
        product_match_status: 'custom',
        variant_attributes: {},
      },
    ]);
  });

  it('retries item insert without condition when the schema cache is behind', async () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const dependencies = createDependencies({
      insertOrderItemsResults: [
        {
          error: createPostgrestError(
            "Could not find the 'condition' column of 'order_items' in the schema cache"
          ),
        },
        { error: null },
      ],
    });

    const result = await createManualOrderWithItems(dependencies, {
      order: orderPayload,
      buildItems,
    });

    expect(result).toEqual({ id: 'order_1' });
    expect(dependencies.insertOrderItems).toHaveBeenCalledTimes(2);
    expect(dependencies.insertOrderItems).toHaveBeenNthCalledWith(
      1,
      buildItems('order_1')
    );
    expect(dependencies.insertOrderItems).toHaveBeenNthCalledWith(2, [
      {
        order_id: 'order_1',
        product_id: 'product_1',
        variant_id: 'variant_1',
        variant_name: 'iPhone 12 128GB · Used',
        name: 'iPhone 12 128GB',
        quantity: 1,
        price: 280000,
        item_description: 'Battery health 89%',
        product_match_status: 'linked',
        variant_attributes: { color: 'Black', storage: '128GB' },
      },
    ]);
    expect(dependencies.deleteOrder).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('retries item insert without product_match_status when the schema cache is behind', async () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const dependencies = createDependencies({
      insertOrderItemsResults: [
        {
          error: createPostgrestError(
            "Could not find the 'product_match_status' column of 'order_items' in the schema cache"
          ),
        },
        { error: null },
      ],
    });

    const result = await createManualOrderWithItems(dependencies, {
      order: orderPayload,
      buildItems,
    });

    expect(result).toEqual({ id: 'order_1' });
    expect(dependencies.insertOrderItems).toHaveBeenCalledTimes(2);
    expect(dependencies.insertOrderItems).toHaveBeenNthCalledWith(
      1,
      buildItems('order_1')
    );
    expect(dependencies.insertOrderItems).toHaveBeenNthCalledWith(2, [
      {
        condition: 'premium_used',
        item_description: 'Battery health 89%',
        name: 'iPhone 12 128GB',
        order_id: 'order_1',
        price: 280000,
        product_id: 'product_1',
        quantity: 1,
        variant_attributes: { color: 'Black', storage: '128GB' },
        variant_id: 'variant_1',
        variant_name: 'iPhone 12 128GB · Used',
      },
    ]);
    expect(dependencies.deleteOrder).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('rolls back the created order when item insert returns a PostgREST error', async () => {
    const itemInsertError = createPostgrestError(
      'new row violates row-level security'
    );
    const dependencies = createDependencies({
      insertOrderItemsResults: [{ error: itemInsertError }],
    });

    await expect(
      createManualOrderWithItems(dependencies, {
        order: orderPayload,
        buildItems,
      })
    ).rejects.toBe(itemInsertError);

    expect(dependencies.deleteOrder).toHaveBeenCalledTimes(1);
    expect(dependencies.deleteOrder).toHaveBeenCalledWith('order_1');
  });

  it('surfaces cleanup failure if rollback of the incomplete order fails', async () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const dependencies = createDependencies({
      insertOrderItemsResults: [
        {
          error: createPostgrestError(
            "Could not find the 'condition' column of 'order_items' in the schema cache"
          ),
        },
        { error: createPostgrestError('fallback insert failed') },
      ],
      deleteOrderError: createPostgrestError('delete failed'),
    });

    await expect(
      createManualOrderWithItems(dependencies, {
        order: orderPayload,
        buildItems,
      })
    ).rejects.toThrow(
      'fallback insert failed. Cleanup failed for incomplete order order_1: delete failed'
    );

    expect(dependencies.deleteOrder).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
