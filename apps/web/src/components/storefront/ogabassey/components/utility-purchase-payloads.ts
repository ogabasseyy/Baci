import type { UtilityCheckoutPayload } from './utility-checkout';
import type { UtilityTabId } from './UtilityTabs';

export interface AirtimeDataSubmit {
  phoneNumber: string;
  amount: number;
  networkProvider: string;
  dataPlanCode?: string;
}

export interface BillSubmit {
  amount: number;
  billItemIdentifier: string;
  billerCode?: string;
  customerAddress?: string;
  customerIdentifier: string;
  billerName: string;
  productCode?: string;
  provider?: 'kuda' | 'monnify';
  requireValidationRef?: boolean;
  type: string;
  validationReference?: string;
}

/**
 * Form submits carry per-tab drafts; the purchase pipeline signs one
 * canonical payload. Extracted from `useUtilityPurchase` to keep that
 * hook under the 300-line modularity budget.
 */
export function buildAirtimeDataPayload(
  data: AirtimeDataSubmit,
  activeTab: UtilityTabId
): UtilityCheckoutPayload {
  return {
    type: activeTab,
    phoneNumber: data.phoneNumber,
    amount: data.amount,
    networkProvider: data.networkProvider,
    dataPlanCode: data.dataPlanCode,
  };
}

export function buildBillPayload(data: BillSubmit): UtilityCheckoutPayload {
  return {
    type: data.type,
    amount: data.amount,
    billItemIdentifier: data.billItemIdentifier,
    billerCode: data.billerCode,
    ...(data.customerAddress ? { customerAddress: data.customerAddress } : {}),
    customerIdentifier: data.customerIdentifier,
    billerName: data.billerName,
    productCode: data.productCode,
    provider: data.provider,
    requireValidationRef: data.requireValidationRef,
    validationReference: data.validationReference,
  };
}
