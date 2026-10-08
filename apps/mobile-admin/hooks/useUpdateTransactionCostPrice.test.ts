import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryClientMock = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
}));

const supabaseMock = vi.hoisted(() => {
  type RpcResult = {
    error: { message: string } | null;
  };

  let rpcResult: RpcResult = { error: null };

  return {
    reset: () => {
      rpcResult = { error: null };
    },
    rpc: vi.fn(() => Promise.resolve(rpcResult)),
    setRpcResult: (result: RpcResult) => {
      rpcResult = result;
    },
  };
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: supabaseMock.rpc,
  },
}));

vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({ merchant: { id: 'merchant-1' } }),
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>(
    '@tanstack/react-query'
  );

  return {
    ...actual,
    useMutation: vi.fn((config) => config),
    useQueryClient: () => queryClientMock,
  };
});

import { useUpdateTransactionCostPrice } from './useUpdateTransactionCostPrice';

type UpdateTransactionReviewDetailsInput = {
  costPrice: number;
  identifierType?: 'imei' | 'serial' | null;
  identifierValue?: string | null;
  orderId: string;
  orderItemId: string;
  productId: string | null;
  supplierName: string;
  transactionDateIso: string;
  unitIndex?: number | null;
  updateProductDefault: boolean;
  variantId: string | null;
};

type TransactionReviewMutation = {
  mutationFn: (input: UpdateTransactionReviewDetailsInput) => Promise<void>;
  onSuccess: () => void;
};

function getMutation() {
  const { result } = renderHook(() => useUpdateTransactionCostPrice());
  return result.current as unknown as TransactionReviewMutation;
}

function makeInput(
  overrides: Partial<UpdateTransactionReviewDetailsInput> = {}
) {
  return {
    costPrice: 125_000,
    orderId: 'order-1',
    orderItemId: 'item-1',
    productId: 'product-1',
    supplierName: 'Main Supplier',
    transactionDateIso: '2026-05-12T12:30:15.250Z',
    updateProductDefault: false,
    variantId: null,
    ...overrides,
  };
}

describe('useUpdateTransactionCostPrice', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    supabaseMock.reset();
  });

  it('saves cost price, supplier, and transaction date through one atomic RPC', async () => {
    const mutation = getMutation();

    await mutation.mutationFn(makeInput());

    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      'update_transaction_review_details',
      {
        p_client_timezone: expect.any(String),
        p_cost_price: 125_000,
        p_identifier_type: null,
        p_identifier_value: null,
        p_merchant_id: 'merchant-1',
        p_order_id: 'order-1',
        p_order_item_id: 'item-1',
        p_product_id: 'product-1',
        p_supplier_name: 'Main Supplier',
        p_transaction_date: '2026-05-12T12:30:15.250Z',
        p_unit_index: null,
        p_update_product_default: false,
        p_variant_id: null,
      }
    );

    mutation.onSuccess();

    expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['transaction-review'],
    });
    expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['monthly-transaction-count'],
    });
    expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['products'],
    });
  });

  it('allows today by calendar day even when the timestamp is later than now', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-12T10:00:00.000Z'));
    const mutation = getMutation();

    await expect(
      mutation.mutationFn(
        makeInput({ transactionDateIso: '2026-05-12T18:30:00.000Z' })
      )
    ).resolves.toBeUndefined();

    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
  });

  it('uses the local calendar day instead of the UTC date key', async () => {
    const previousTimeZone = process.env.TZ;
    process.env.TZ = 'Africa/Lagos';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-12T23:30:00.000Z'));
    const mutation = getMutation();

    try {
      await expect(
        mutation.mutationFn(
          makeInput({ transactionDateIso: '2026-05-13T00:00:00.000Z' })
        )
      ).resolves.toBeUndefined();
    } finally {
      if (previousTimeZone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTimeZone;
      }
    }

    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
  });

  it('rejects future transaction calendar days before saving', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-12T10:00:00.000Z'));
    const mutation = getMutation();

    await expect(
      mutation.mutationFn(
        makeInput({ transactionDateIso: '2026-05-13T00:00:00.000Z' })
      )
    ).rejects.toThrow('Transaction date cannot be in the future.');

    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it('rejects invalid cost prices before saving', async () => {
    const mutation = getMutation();

    await expect(
      mutation.mutationFn(makeInput({ costPrice: -1 }))
    ).rejects.toThrow('Cost price must be a non-negative number');

    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it('rejects invalid transaction dates before saving', async () => {
    const mutation = getMutation();

    await expect(
      mutation.mutationFn(makeInput({ transactionDateIso: 'not-a-date' }))
    ).rejects.toThrow('Enter a valid transaction date.');

    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it('rejects missing transaction or line item identifiers before saving', async () => {
    const mutation = getMutation();

    await expect(
      mutation.mutationFn(makeInput({ orderId: '   ', orderItemId: '' }))
    ).rejects.toThrow('Transaction and line item are required');

    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it('rejects missing supplier names before saving', async () => {
    const mutation = getMutation();

    await expect(
      mutation.mutationFn(makeInput({ supplierName: '   ' }))
    ).rejects.toThrow('Supplier name is required');

    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it('trims supplier names before saving', async () => {
    const mutation = getMutation();

    await mutation.mutationFn(makeInput({ supplierName: '  Main Supplier  ' }));

    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      'update_transaction_review_details',
      expect.objectContaining({
        p_supplier_name: 'Main Supplier',
      })
    );
  });

  it('saves an unlinked custom order item without a product id', async () => {
    const mutation = getMutation();

    await mutation.mutationFn(
      makeInput({
        orderItemId: 'item-custom',
        productId: null,
        updateProductDefault: false,
        variantId: null,
      })
    );

    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      'update_transaction_review_details',
      expect.objectContaining({
        p_order_item_id: 'item-custom',
        p_product_id: null,
        p_update_product_default: false,
        p_variant_id: null,
      })
    );
  });

  it('passes the variant id when saving a variant-backed order item', async () => {
    const mutation = getMutation();

    await mutation.mutationFn(
      makeInput({
        orderItemId: 'item-variant',
        productId: 'product-1',
        updateProductDefault: true,
        variantId: 'variant-1',
      })
    );

    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      'update_transaction_review_details',
      expect.objectContaining({
        p_order_item_id: 'item-variant',
        p_product_id: 'product-1',
        p_update_product_default: true,
        p_variant_id: 'variant-1',
      })
    );
  });

  it('forwards unit-level identifier fields to the RPC for per-unit cost edits', async () => {
    const mutation = getMutation();

    await mutation.mutationFn(
      makeInput({
        identifierType: 'imei',
        identifierValue: '356938035643809',
        unitIndex: 0,
      })
    );

    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      'update_transaction_review_details',
      expect.objectContaining({
        p_identifier_type: 'imei',
        p_identifier_value: '356938035643809',
        p_unit_index: 0,
      })
    );
  });

  it('rejects unsupported identifier types before saving', async () => {
    const mutation = getMutation();

    await expect(
      mutation.mutationFn(
        makeInput({
          identifierType: 'barcode' as unknown as 'imei',
          identifierValue: 'ABC123',
          unitIndex: 0,
        })
      )
    ).rejects.toThrow('Identifier type must be imei or serial.');

    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it('rejects invalid unit indexes before saving', async () => {
    const mutation = getMutation();

    await expect(
      mutation.mutationFn(makeInput({ unitIndex: -1 }))
    ).rejects.toThrow('Unit index must be a non-negative integer.');

    await expect(
      mutation.mutationFn(makeInput({ unitIndex: 1.5 }))
    ).rejects.toThrow('Unit index must be a non-negative integer.');

    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it('defaults unit-level fields to null for order-item-level cost edits', async () => {
    const mutation = getMutation();

    await mutation.mutationFn(makeInput());

    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      'update_transaction_review_details',
      expect.objectContaining({
        p_identifier_type: null,
        p_identifier_value: null,
        p_unit_index: null,
      })
    );
  });

  it('surfaces RPC save errors', async () => {
    supabaseMock.setRpcResult({
      error: { message: 'Transaction not found for this merchant' },
    });
    const mutation = getMutation();

    await expect(mutation.mutationFn(makeInput())).rejects.toThrow(
      'Transaction not found for this merchant'
    );
  });
});
