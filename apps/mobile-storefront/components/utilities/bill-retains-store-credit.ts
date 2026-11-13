import type { CreateBillFormPurchaseHandlerInput } from './bill-form-purchase.types';
import { buildBillPurchaseRequest } from './build-bill-purchase-request';
import { resolveBillCustomerOfRecord } from './resolve-bill-customer-of-record';

type Input = Pick<
  CreateBillFormPurchaseHandlerInput,
  | 'billType'
  | 'customer'
  | 'customerId'
  | 'numericAmount'
  | 'payment'
  | 'requireValidationRef'
  | 'selectedBiller'
  | 'selectedBillItem'
  | 'selectedBillItemIdentifier'
  | 'selectedBillItemPathLabel'
  | 'validationReference'
  | 'verifiedCustomerAddress'
  | 'verifiedCustomerName'
>;

/**
 * Whether this exact bill purchase has a retained store credit attempt: the
 * same request (and so the same retry identity) the submit handler builds,
 * so a replay that will settle on store credit is never shown as paid from
 * the savings wallet. A peek: it never mints a key.
 */
export function billRetainsStoreCredit(input: Input): boolean {
  if (!input.selectedBiller || !(input.numericAmount > 0)) return false;
  const { customerName, customerAddress } = resolveBillCustomerOfRecord({
    customer: input.customer,
    verifiedCustomerName: input.verifiedCustomerName,
    verifiedCustomerAddress: input.verifiedCustomerAddress,
  });
  const request = buildBillPurchaseRequest({
    amount: input.numericAmount,
    billItem: input.selectedBillItem,
    biller: input.selectedBiller,
    billItemIdentifier: input.selectedBillItemIdentifier,
    billItemPathLabel: input.selectedBillItemPathLabel,
    customerIdentifier: input.customerId,
    customerName,
    customerAddress,
    customerPhone: input.customer?.phone,
    requireValidationRef: input.requireValidationRef,
    type: input.billType,
    validationReference: input.validationReference,
  });
  return input.payment.hasRetainedVtuAttempt?.(request) === true;
}
