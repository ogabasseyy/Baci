import { randomUUID } from 'node:crypto';
import 'server-only';
import { createQuizRpcServerProof } from '@/lib/quiz-proof';

export interface RedvaultProofGroup {
  condition: string | null;
  discountKobo: number;
  lineSubtotalKobo: number;
  members: Array<{
    allocationKobo: number;
    lineId: number;
    orderItemId: string;
    quantity: number;
  }>;
  productId: string;
  taxInclusive: false;
  unitPriceKobo: number;
  variantAttributes: Record<string, string>;
  variantId: string | null;
  vatCategoryCode: string | null;
  vatRateBp: number;
}

export function createRedvaultDiscountProof({
  customerEmail,
  groups,
  merchantId,
  orderId,
  quotePayloadHash,
  quoteVersionId,
  totals,
  userId,
}: {
  customerEmail: string;
  groups: RedvaultProofGroup[];
  merchantId: string;
  orderId: string;
  quotePayloadHash: string;
  quoteVersionId: string;
  totals: {
    discountKobo: number;
    eligibleSubtotalKobo: number;
    productSubtotalKobo: number;
  };
  userId: string;
}) {
  const nonce = randomUUID();
  const proof = createQuizRpcServerProof({
    action: 'storefront_redvault_discount',
    payload: {
      customerEmail,
      discountKobo: totals.discountKobo,
      eligibleSubtotalKobo: totals.eligibleSubtotalKobo,
      groups,
      merchantId,
      nonce,
      orderId,
      partnership: 'uba_redvault',
      productSubtotalKobo: totals.productSubtotalKobo,
      quotePayloadHash,
      quoteVersionId,
      taxBasis: 'exclusive',
      version: 1,
    },
    subjectId: merchantId,
    userId,
  });

  return { nonce, proof };
}
