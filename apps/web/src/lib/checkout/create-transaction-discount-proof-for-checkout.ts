import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { createTransactionDiscountProof } from './create-transaction-discount-proof';

type CreateTransactionDiscountProofInput = Parameters<
  typeof createTransactionDiscountProof
>[0];
type CreateTransactionDiscountProofCheckoutResult =
  | {
      ok: true;
      proof: ReturnType<typeof createTransactionDiscountProof>;
    }
  | {
      ok: false;
      response: NextResponse;
    };

/** Creates checkout provenance or returns the consistent signing-unavailable response. */
export function createTransactionDiscountProofForCheckout(
  input: CreateTransactionDiscountProofInput
): CreateTransactionDiscountProofCheckoutResult {
  try {
    return { ok: true, proof: createTransactionDiscountProof(input) };
  } catch (error) {
    logger.warn({
      error,
      merchantId: input.merchantId,
      message: 'Transaction discount provenance proof unavailable',
    });
    return {
      ok: false,
      response: NextResponse.json(
        {
          code: 'TRANSACTION_DISCOUNT_PROOF_UNAVAILABLE',
          error: 'Unable to create order right now. Please try again.',
        },
        { status: 503 }
      ),
    };
  }
}
