import {
  appendReceiptFulfillmentDescription,
  type ReceiptFulfillmentDetails,
  type ReceiptOrder,
} from '@baci/shared';
import type { ImmediateOrderNotificationContext } from './notification-context';
import {
  buildImmediateInvoiceShippingAddress,
  getOrderItemBaseName,
  getOrderItemCondition,
  getOrderItemVariantLabel,
} from './order-item-primitives';
import type { ImmediateInvoiceOrderItem } from './persisted-invoice-items';

/**
 * Receipt-order view for the invoice PDF: canonical persisted items
 * shaped into receipt lines. Extracted from
 * buildImmediateInvoiceArtifacts so the artifact orchestrator stays
 * focused on provisioning, rendering, and persistence.
 */
export function buildInvoiceReceiptOrder(input: {
  ctx: ImmediateOrderNotificationContext;
  invoiceItems: ImmediateInvoiceOrderItem[];
  fulfillment: ReceiptFulfillmentDetails | null;
  hasDeviceItem: boolean;
  amountPaid: number;
  invoiceVirtualAccount: ReceiptOrder['virtual_account'];
}): ReceiptOrder {
  const {
    ctx,
    invoiceItems,
    fulfillment,
    hasDeviceItem,
    amountPaid,
    invoiceVirtualAccount,
  } = input;
  const { order, orderNum } = ctx;
  return {
    order_number: orderNum,
    created_at: String(order.created_at || new Date().toISOString()),
    currency: ctx.orderCurrency,
    total: ctx.orderTotal,
    subtotal: ctx.orderSubtotal,
    shipping_fee: ctx.orderShippingFee,
    tax_amount: Number(order.tax_amount || 0),
    discount_amount: Number(order.discount_amount || 0),
    amount_paid: amountPaid,
    balance: Math.max(ctx.orderTotal - amountPaid, 0),
    payment_status: ctx.immediateEmail.isPaidForEmail
      ? 'paid'
      : order.payment_status || ctx.paymentStatus || 'unpaid',
    payment_method: ctx.effectivePaymentMethod,
    is_credit_order: Boolean(
      (order as Record<string, unknown>).is_credit_order
    ),
    customer_name: ctx.customerName,
    customer_email: ctx.customerEmail,
    customer_phone: ctx.customerPhone || null,
    shipping_address: buildImmediateInvoiceShippingAddress(ctx.shippingAddress),
    virtual_account: invoiceVirtualAccount,
    fulfillment_details: fulfillment,
    items: invoiceItems.map((item, index) => {
      const variantName = getOrderItemVariantLabel(item, {
        includeConditionFallback: false,
      });

      return {
        line_id: index + 1,
        product_id: item.product_id || null,
        product_name: getOrderItemBaseName(item),
        condition: getOrderItemCondition(item),
        variant_id: item.variant_id || null,
        variant_name: variantName || undefined,
        description: appendReceiptFulfillmentDescription({
          description: undefined,
          fulfillment,
          hasDeviceItem,
          index,
          itemName: getOrderItemBaseName(item),
        }),
        quantity: item.quantity,
        price: item.negotiatedPrice ?? item.price,
      };
    }),
    transactions: [],
  };
}
