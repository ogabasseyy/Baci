import type { ReceiptOrder } from '@baci/shared';
import { formatCanonicalProductConditionLabel } from '@baci/shared/lib';
import { isArchiveOrder } from '@/app/(storefront)/[slug]/(customer)/receipts/archive-order-filter';
import type { StorefrontOrder } from '@/types/storefront-order';
import { formatReceiptListDate } from '../receipt-list-date';

const currencyFormatterCache = new Map<string, Intl.NumberFormat>();

function getCurrencyFormatter(currency: string): Intl.NumberFormat {
  // A malformed staff-entered code must not crash the whole list: fall
  // back to NGN for display (the document pipeline fails closed on it).
  const code = /^[A-Za-z]{3}$/.test(currency) ? currency : 'NGN';
  let formatter = currencyFormatterCache.get(code);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 0,
    });
    currencyFormatterCache.set(code, formatter);
  }
  return formatter;
}

/** List item for display in the receipts grid */
export interface ReceiptListItem {
  id: string;
  order_number: string;
  date: string;
  total: string;
  status: 'Paid' | 'Partially Paid' | 'Unpaid';
  paymentStatus: 'paid' | 'partially_paid' | 'unpaid';
  /** Resolved proforma kind from the orders API invoice type code. */
  documentKind: 'proforma' | null;
  balance: string;
  firstProductName: string;
  firstProductImage: string | null;
  additionalDeviceCount: number;
  /** Raw order data for the shared receipt generator */
  rawOrder: ReceiptOrder;
}

export interface ReceiptCustomerInfo {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
}

function getStringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getReceiptItemImage(item: Record<string, unknown> | undefined) {
  if (!item) {
    return null;
  }

  return (
    getStringValue(item.product_image) ||
    getStringValue(item.image) ||
    getStringValue(item.image_url) ||
    (Array.isArray(item.product_images)
      ? getStringValue(item.product_images[0])
      : null)
  );
}

function getReceiptItemName(item: Record<string, unknown> | undefined) {
  if (!item) {
    return 'Unknown item';
  }

  return (
    getStringValue(item.product_name) ||
    getStringValue(item.name) ||
    'Unknown item'
  );
}

function getReceiptItemVariantName(item: Record<string, unknown> | undefined) {
  return (
    getStringValue(item?.variant_name) ||
    formatCanonicalProductConditionLabel(getStringValue(item?.condition))
  );
}

function getReceiptItemDisplayName(item: Record<string, unknown> | undefined) {
  const baseName = getReceiptItemName(item);
  const variantName = getReceiptItemVariantName(item);
  return variantName && !baseName.includes(`(${variantName})`)
    ? `${baseName} (${variantName})`
    : baseName;
}

function getReceiptItemQuantity(item: Record<string, unknown>) {
  const quantity = Number(item.quantity);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function getAdditionalDeviceCount(items: Array<Record<string, unknown>>) {
  const totalDeviceCount = items.reduce(
    (count, item) => count + getReceiptItemQuantity(item),
    0
  );

  return Math.max(0, totalDeviceCount - 1);
}

// Module-scope helper keeps async fetch/mapping logic out of the component
// body so React Compiler can memoize the component.
export async function fetchReceiptListItems(
  merchantSlug: string,
  customer: ReceiptCustomerInfo | null
): Promise<ReceiptListItem[] | null> {
  const res = await fetch(
    `/api/storefront/orders?merchantSlug=${encodeURIComponent(merchantSlug)}`
  );
  const data = await res.json();

  if (!data.orders) {
    return null;
  }

  const customerName = customer
    ? `${customer.first_name || ''} ${customer.last_name || ''}`.trim() ||
      'Customer'
    : 'Customer';

  // Fail unavailable documents closed like the standard archive: without
  // this, an invalid manual order renders a View action for a document the
  // routes cannot serve. The API rows carry the same eligibility flags.
  return data.orders
    .filter((order: Record<string, unknown>) =>
      isArchiveOrder(order as unknown as StorefrontOrder)
    )
    .map((order: Record<string, unknown>) => {
      const items = (order.items as Array<Record<string, unknown>>) ?? [];
      const currency = (order.currency as string) || 'NGN';
      const total = Number(order.total) || 0;
      const amountPaid = Number(order.amount_paid ?? total);
      const paymentStatus = (order.payment_status as string) || 'unpaid';
      const firstProductName = getReceiptItemDisplayName(items[0]);
      const additionalDeviceCount = getAdditionalDeviceCount(items);

      const formatCurrency = (val: number) =>
        getCurrencyFormatter(currency).format(val);

      // The modal and print renderer infer the document from payment_status;
      // a settled manual balance reports kind receipt under a non-paid label,
      // so normalize the renderer input to match the emailed/downloaded kind.
      // The list badge below keeps the truthful staff-facing label.
      const rendererPaymentStatus =
        (order.current_document_kind as string) === 'receipt'
          ? 'paid'
          : paymentStatus;

      // The orders API resolves unpaid invoice-method orders to Peppol type
      // 325 (proforma); carry that kind so the modal labels and prints the
      // emailed proforma instead of an ordinary invoice. Settled orders keep
      // the commercial receipt even if a stale 325 travels with them.
      const documentKind =
        (order.invoice_type_code as string) === '325' &&
        rendererPaymentStatus !== 'paid'
          ? 'proforma'
          : null;

      // A paid receipt is dated by its completing payment like the emailed
      // PDF and account download, never by the untouched order dates; a
      // stale invoice issue date would otherwise win in the renderer.
      const isPaidRenderer = rendererPaymentStatus === 'paid';
      const completionDate = getStringValue(order.receipt_completion_date);

      const rawOrder: ReceiptOrder = {
        order_number:
          (order.order_number as string) ||
          String(order.id).slice(0, 8).toUpperCase(),
        created_at: order.created_at as string,
        transaction_date: isPaidRenderer
          ? (completionDate ??
            (order.transaction_date as string | null | undefined))
          : (order.transaction_date as string | null | undefined),
        invoice_issue_date: isPaidRenderer
          ? undefined
          : (order.invoice_issue_date as string | null | undefined),
        currency,
        total,
        subtotal: Number(order.subtotal ?? total),
        shipping_fee: Number(order.shipping_fee ?? 0),
        tax_amount: Number(order.tax_amount ?? 0),
        discount_amount: Number(order.discount_amount ?? 0),
        amount_paid: amountPaid,
        balance: Number(order.balance ?? total - amountPaid),
        payment_status: rendererPaymentStatus,
        payment_method: (order.payment_method as string) ?? null,
        is_credit_order: (order.is_credit_order as boolean) ?? false,
        customer_name: customerName,
        customer_email: customer?.email || '',
        customer_phone: customer?.phone ?? null,
        shipping_address:
          (order.shipping_address as ReceiptOrder['shipping_address']) ?? null,
        virtual_account:
          (order.virtual_account as ReceiptOrder['virtual_account']) ?? null,
        fulfillment_details:
          (order.fulfillment_details as ReceiptOrder['fulfillment_details']) ??
          null,
        items: items.map((item) => ({
          product_name: getReceiptItemName(item),
          variant_name: getReceiptItemVariantName(item) || undefined,
          quantity: getReceiptItemQuantity(item),
          price: Number(item.price) || 0,
        })),
      };

      const statusLabel =
        paymentStatus === 'paid'
          ? 'Paid'
          : paymentStatus === 'partially_paid'
            ? 'Partially Paid'
            : 'Unpaid';

      return {
        id: order.id as string,
        order_number: rawOrder.order_number,
        date: formatReceiptListDate(
          (order.invoice_issue_date as string | null | undefined) ||
            (order.transaction_date as string | null | undefined) ||
            (order.created_at as string)
        ),
        total: formatCurrency(total),
        status: statusLabel,
        paymentStatus: paymentStatus as ReceiptListItem['paymentStatus'],
        documentKind,
        balance: formatCurrency(Math.max(0, total - amountPaid)),
        firstProductName,
        firstProductImage: getReceiptItemImage(items[0]),
        additionalDeviceCount,
        rawOrder,
      } satisfies ReceiptListItem;
    });
}
