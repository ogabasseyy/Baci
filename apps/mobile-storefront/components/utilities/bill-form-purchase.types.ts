import type { useUtilityPayment } from '@/hooks/use-utility-payment';
import type { Biller, BillItem } from '@/hooks/use-vtu-billers';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import type { BillFormProps } from './bill-form.types';

export type PaymentState = ReturnType<typeof useUtilityPayment>;

export interface BillCustomer {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface CreateBillFormPurchaseHandlerInput {
  amount: string;
  billType: 'electricity' | 'cable_tv' | 'betting';
  canShowPayment: boolean;
  customer: BillCustomer | null | undefined;
  customerId: string;
  dismissKeyboard: () => void;
  getIsSubmitting: () => boolean;
  numericAmount: number;
  onSuccess: BillFormProps['onSuccess'];
  payment: PaymentState;
  selectedBiller: Biller | null;
  selectedBillItem: BillItem | null;
  selectedBillItemIdentifier: string | null;
  selectedBillItemPathLabel: string;
  setIsSubmitting: (isSubmitting: boolean) => void;
  type: BillFormProps['type'];
  requireValidationRef?: boolean;
  validationReference?: string;
  /**
   * Prefilled return link for the insufficient-balance funding prompt, so a
   * wallet top-up round-trips the customer back to the purchase form.
   */
  returnToHref?: WalletReturnHref | null;
  /**
   * Verified bill customer-of-record name (meter owner / account holder)
   * from the verify step or a previous successful purchase. When present,
   * sent as the API payload's `customerName` so the row's `customer_name`
   * column reflects the bill recipient, not the buyer.
   */
  verifiedCustomerName: string | null;
  /**
   * Verified meter/customer address from the verify step (validate-customer).
   * Sent as the API payload's `customerAddress` and persisted to metadata so the
   * receipt can show it. Null when the provider doesn't return an address.
   */
  verifiedCustomerAddress: string | null;
}
