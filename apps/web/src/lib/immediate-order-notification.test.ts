import { describe, expect, it } from 'vitest';
import * as barrel from './immediate-order-notification';
import {
  getCreditedAmountPaid,
  getImmediateEmailAmountDue,
} from './immediate-order/invoice-credit';

// The order-create route consumes this surface; the split into
// ./immediate-order/* must keep every name available from the barrel.
const EXPECTED_EXPORTS = [
  'SERVER_ASSURANCE_RATE',
  'buildImmediateInvoiceArtifacts',
  'buildImmediateInvoiceShippingAddress',
  'buildImmediatePeppolInvoiceData',
  'getCreditedAmountPaid',
  'getImmediateEmailAmountDue',
  'getImmediateInvoiceDueDate',
  'getImmediateInvoiceIssueDate',
  'getOptionalString',
  'getOrderFulfillmentDetails',
  'getOrderItemBaseName',
  'getOrderItemCondition',
  'getOrderItemDisplayName',
  'getOrderItemProductId',
  'getOrderItemUnitPrice',
  'getOrderItemVariantLabel',
  'getStringRecord',
  'loadPersistedInvoiceOrderItems',
  'provisionPayformeRetryDva',
  'provisionPreResponsePayformeDva',
  'queueMerchantOrderNotifications',
  'roundCurrency',
  'sendImmediateOrderConfirmationEmail',
  'toFiniteNumber',
];

describe('immediate-order-notification barrel', () => {
  it.each(EXPECTED_EXPORTS)('re-exports %s', (name) => {
    expect(barrel[name as keyof typeof barrel]).toBeDefined();
  });

  it('exposes the credited-balance rule used by email, PDF, and DVA guard', () => {
    expect(
      getCreditedAmountPaid(
        { id: 'order-1', amount_paid: 3000 } as never,
        1000,
        500
      )
    ).toBe(3000);
    expect(
      getCreditedAmountPaid({ id: 'order-1' } as never, 1000, 500)
    ).toBe(1500);
  });

  it('floors the email amount due at zero', () => {
    expect(getImmediateEmailAmountDue(5000, 1500)).toBe(3500);
    expect(getImmediateEmailAmountDue(5000, 6000)).toBe(0);
  });
});
