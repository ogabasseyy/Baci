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
  const request = billPurchaseRequest(input);
  return (
    request !== null && input.payment.hasRetainedVtuAttempt?.(request) === true
  );
}

/**
 * The exact request the submit builds for this bill (its retry identity),
 * or null before a provider and an amount are chosen.
 */
export function billPurchaseRequest(input: Omit<Input, 'payment'>) {
  if (!input.selectedBiller || !(input.numericAmount > 0)) return null;
  const { customerName, customerAddress } = resolveBillCustomerOfRecord({
    customer: input.customer,
    verifiedCustomerName: input.verifiedCustomerName,
    verifiedCustomerAddress: input.verifiedCustomerAddress,
  });
  return buildBillPurchaseRequest({
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
}
