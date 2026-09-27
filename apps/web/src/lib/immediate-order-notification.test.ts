import { describe, expect, it } from 'vitest';
import {
  getCreditedAmountPaid,
  getImmediateEmailAmountDue,
} from './immediate-order/invoice-credit';
import * as barrel from './immediate-order-notification';

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
  // Static snapshot of the namespace: dynamic member access on the
  // namespace import itself trips noDynamicNamespaceImportAccess.
  const barrelSurface: Record<string, unknown> = { ...barrel };
  it.each(EXPECTED_EXPORTS)('re-exports %s', (name) => {
    expect(barrelSurface[name]).toBeDefined();
  });

  it('exposes the credited-balance rule used by email, PDF, and DVA guard', () => {
    expect(
      getCreditedAmountPaid(
        { id: 'order-1', amount_paid: 3000 } as never,
        1000,
        500
      )
    ).toBe(3000);
    expect(getCreditedAmountPaid({ id: 'order-1' } as never, 1000, 500)).toBe(
      1500
    );
  });

  it('floors the email amount due at zero', () => {
    expect(getImmediateEmailAmountDue(5000, 1500)).toBe(3500);
    expect(getImmediateEmailAmountDue(5000, 6000)).toBe(0);
  });
});
