import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreateQuizRpcServerProof } = vi.hoisted(() => ({
  mockCreateQuizRpcServerProof: vi.fn(),
}));

vi.mock('@/lib/quiz-proof', () => ({
  createQuizRpcServerProof: mockCreateQuizRpcServerProof,
}));

import { createTransactionDiscountProof } from './create-transaction-discount-proof';

describe('createTransactionDiscountProof', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateQuizRpcServerProof.mockReturnValue({ proof_id: 'proof-id' });
  });

  it('binds the line allocations, merchant, user, and nonce into the proof', () => {
    const lineDiscounts = [
      {
        lineId: 1,
        merchandiseDiscount: 20,
        productId: 'product-1',
        vatRelief: 1.5,
        variantId: null,
      },
    ];

    const result = createTransactionDiscountProof({
      lineDiscounts,
      merchantId: 'merchant-1',
      userId: 'user-1',
    });

    expect(result.proof).toEqual({ proof_id: 'proof-id' });
    expect(result.nonce).toMatch(/^[0-9a-f-]{36}$/);
    expect(mockCreateQuizRpcServerProof).toHaveBeenCalledWith({
      action: 'storefront_transaction_discount',
      payload: {
        lineDiscounts,
        nonce: result.nonce,
        version: 3,
      },
      subjectId: 'merchant-1',
      userId: 'user-1',
    });
  });

  it('propagates signing failures to the caller', () => {
    mockCreateQuizRpcServerProof.mockImplementation(() => {
      throw new Error('missing_quiz_rpc_server_secret');
    });

    expect(() =>
      createTransactionDiscountProof({
        lineDiscounts: [],
        merchantId: 'merchant-1',
        userId: 'guest',
      })
    ).toThrow('missing_quiz_rpc_server_secret');
  });
});
