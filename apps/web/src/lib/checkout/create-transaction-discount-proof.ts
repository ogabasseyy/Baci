import { randomUUID } from 'node:crypto';
import type { TransactionDiscountLineAllocation } from '@baci/shared/contracts';
import { createQuizRpcServerProof } from '@/lib/quiz-proof';

interface CreateTransactionDiscountProofInput {
  lineDiscounts: Array<TransactionDiscountLineAllocation | null>;
  merchantId: string;
  userId: string;
}

/** Creates the signed, nonce-bound provenance payload for server discounts. */
export function createTransactionDiscountProof({
  lineDiscounts,
  merchantId,
  userId,
}: CreateTransactionDiscountProofInput) {
  const nonce = randomUUID();
  const proof = createQuizRpcServerProof({
    action: 'storefront_transaction_discount',
    payload: {
      lineDiscounts,
      nonce,
      version: 3,
    },
    subjectId: merchantId,
    userId,
  });

  return { nonce, proof };
}
