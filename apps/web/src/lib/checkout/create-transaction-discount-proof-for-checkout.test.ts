import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreateQuizRpcServerProof, mockLoggerWarn } = vi.hoisted(() => ({
  mockCreateQuizRpcServerProof: vi.fn(),
  mockLoggerWarn: vi.fn(),
}));

vi.mock('@/lib/quiz-proof', () => ({
  createQuizRpcServerProof: mockCreateQuizRpcServerProof,
}));
vi.mock('@/lib/logger', () => ({
  logger: { warn: mockLoggerWarn },
}));

import { createTransactionDiscountProofForCheckout } from './create-transaction-discount-proof-for-checkout';

const input = {
  lineDiscounts: [
    {
      lineId: 1,
      merchandiseDiscount: 20,
      productId: 'product-1',
      vatRelief: 1.5,
      variantId: null,
    },
  ],
  merchantId: 'merchant-1',
  userId: 'user-1',
};

describe('createTransactionDiscountProofForCheckout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateQuizRpcServerProof.mockReturnValue({ proof_id: 'proof-id' });
  });

  it('returns the signed proof when checkout provenance can be created', () => {
    const result = createTransactionDiscountProofForCheckout(input);

    expect(result).toMatchObject({
      ok: true,
      proof: { nonce: expect.any(String), proof: { proof_id: 'proof-id' } },
    });
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it('returns the checkout 503 response when signing fails', async () => {
    const signingError = new Error('missing_quiz_rpc_server_secret');
    mockCreateQuizRpcServerProof.mockImplementation(() => {
      throw signingError;
    });

    const result = createTransactionDiscountProofForCheckout(input);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(503);
      await expect(result.response.json()).resolves.toEqual({
        code: 'TRANSACTION_DISCOUNT_PROOF_UNAVAILABLE',
        error: 'Unable to create order right now. Please try again.',
      });
    }
    expect(mockLoggerWarn).toHaveBeenCalledWith({
      error: signingError,
      merchantId: 'merchant-1',
      message: 'Transaction discount provenance proof unavailable',
    });
  });
});
