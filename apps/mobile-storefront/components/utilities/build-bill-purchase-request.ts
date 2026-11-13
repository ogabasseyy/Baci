import type { VTUCheckoutPayload } from '@/lib/vtu-checkout-response-schemas';
import { resolveBillFulfillment } from './resolve-bill-fulfillment';

type Fulfillment = Parameters<typeof resolveBillFulfillment>;

/**
 * The wallet-only bill purchase the form submits: Kuda-display +
 * Monnify-fulfillment routing (folded items vend via Monnify), the
 * customer of record and the validation context, exactly as the store
 * credit and PiggyVest paths send it.
 */
export function buildBillPurchaseRequest(input: {
  amount: number;
  billItem: Fulfillment[0];
  biller: Fulfillment[1] & { billerName: string };
  billItemIdentifier: string | null | undefined;
  billItemPathLabel: string | null | undefined;
  customerIdentifier: string | undefined;
  customerName: string | undefined;
  customerAddress?: string | null;
  customerPhone?: string | null;
  requireValidationRef?: boolean;
  type: VTUCheckoutPayload['type'];
  validationReference?: string | null;
}) {
  const { provider, billerCode, productCode } = resolveBillFulfillment(
    input.billItem,
    input.biller,
    input.billItemIdentifier ?? undefined
  );
  return {
    amount: input.amount,
    billItemIdentifier: input.billItemIdentifier ?? undefined,
    billerCode,
    billerName: input.billItemPathLabel
      ? `${input.biller.billerName} - ${input.billItemPathLabel}`
      : input.biller.billerName,
    customerIdentifier: input.customerIdentifier,
    customerName: input.customerName,
    ...(input.customerAddress
      ? { customerAddress: input.customerAddress }
      : {}),
    customerPhone: input.customerPhone || undefined,
    productCode,
    provider,
    ...(input.requireValidationRef !== undefined
      ? { requireValidationRef: input.requireValidationRef }
      : {}),
    type: input.type,
    ...(input.validationReference
      ? { validationReference: input.validationReference }
      : {}),
    walletAmount: input.amount,
  };
}
