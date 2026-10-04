import type { ReceiptOrder } from '@baci/shared';
import {
  getAdditionalDeviceCount,
  getOptionalReceiptItemNumber,
  getReceiptItemDisplayName,
  getReceiptItemImage,
  getReceiptItemName,
  getReceiptItemQuantity,
  getReceiptItemVariantName,
  getReceiptListItemStringValue,
} from './receipt-list-item-fields';
import { isArchiveOrder } from '@/app/(storefront)/[slug]/(customer)/receipts/archive-order-filter';
import { normalizeReceiptShippingAddress } from '@/lib/build-manual-order-document-pdf-input';
import {
  buildAssuranceReceiptItem,
  sumAssuranceFees,
} from '@/lib/insurance-assurance-line';
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
      // The list badge follows the same normalized status: a receipt-kind
      // row badges Paid even under its stale stored label.
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
      const completionDate = getReceiptListItemStringValue(order.receipt_completion_date);

      // Project the line details the emailed PDF renders: without them
      // the preview computes quantity x price and drops VAT/SKU/unit, so it
      // can disagree with the sent document on explicit extensions.
      const rawItems: Array<{
        product_name: string;
        variant_name?: string | null | undefined;
        quantity: number;
        price: number;
        description?: string | null | undefined;
        line_extension_amount?: number | undefined;
        unit_code?: string | null | undefined;
        vat_category_code?: string | null | undefined;
        vat_rate?: number | null | undefined;
        vat_amount?: number | null | undefined;
        sellers_item_id?: string | null | undefined;
      }> = items.map((item) => ({
        product_name: getReceiptItemName(item),
        variant_name: getReceiptItemVariantName(item) || undefined,
        quantity: getReceiptItemQuantity(item),
        price: Number(item.price) || 0,
        description: getReceiptListItemStringValue(item.item_description) ?? undefined,
        line_extension_amount: getOptionalReceiptItemNumber(
          item,
          'line_extension_amount'
        ),
        unit_code: getReceiptListItemStringValue(item.unit_code),
        vat_category_code: getReceiptListItemStringValue(item.vat_category_code),
        vat_rate: getOptionalReceiptItemNumber(item, 'vat_rate') ?? null,
        vat_amount: getOptionalReceiptItemNumber(item, 'vat_amount') ?? null,
        sellers_item_id: getReceiptListItemStringValue(item.sellers_item_id),
      }));
      // Itemize the premium like the emailed PDF and download so the
      // preview lines reconcile with the displayed total.
      const assuranceTotal = sumAssuranceFees(items);
      if (assuranceTotal > 0) {
        rawItems.push(buildAssuranceReceiptItem(assuranceTotal));
      }

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
        // Invoice-only terms block: the modal renders what the emailed
        // PDF renders, so forward every settled field instead of null.
        invoice_note: (order.invoice_note as string) ?? null,
        notes: (order.notes as string) ?? null,
        payment_due_date: (order.payment_due_date as string) ?? null,
        payment_terms: (order.payment_terms as string) ?? null,
        buyer_reference: (order.buyer_reference as string) ?? null,
        firs_irn: (order.firs_irn as string) ?? null,
        firs_csid: (order.firs_csid as string) ?? null,
        is_credit_order: (order.is_credit_order as boolean) ?? false,
        // The order-scoped claim flow can re-link an order to the
        // recipient's existing customer row, leaving the order's snapshotted
        // contact intentionally different from the profile: bill to the order
        // snapshot like the emailed attachment and download, profile fallback.
        customer_name: (order.customer_name as string) || customerName,
        customer_email:
          (order.customer_email as string) || customer?.email || '',
        customer_phone:
          (order.customer_phone as string | null | undefined) ??
          customer?.phone ??
          null,
        // Legacy mobile-admin aliases collapse like the emailed PDF.
        shipping_address: normalizeReceiptShippingAddress(
          order.shipping_address
        ),
        virtual_account:
          (order.virtual_account as ReceiptOrder['virtual_account']) ?? null,
        fulfillment_details:
          (order.fulfillment_details as ReceiptOrder['fulfillment_details']) ??
          null,
        items: rawItems,
        // Settled payment history from the orders API: partial manual
        // invoices preview the same Payment table as the emailed document.
        transactions: (order.transactions as ReceiptOrder['transactions']) ?? [],
      };

      const statusLabel =
        rendererPaymentStatus === 'paid'
          ? 'Paid'
          : rendererPaymentStatus === 'partially_paid'
            ? 'Partially Paid'
            : 'Unpaid';

      return {
        id: order.id as string,
        order_number: rawOrder.order_number,
        // A paid card shows the completing payment like the preview;
        // otherwise the issued invoice date, the sale date, creation.
        date: formatReceiptListDate(
          (isPaidRenderer ? completionDate : null) ||
            (order.invoice_issue_date as string | null | undefined) ||
            (order.transaction_date as string | null | undefined) ||
            (order.created_at as string)
        ),
        total: formatCurrency(total),
        status: statusLabel,
        paymentStatus:
          rendererPaymentStatus as ReceiptListItem['paymentStatus'],
        documentKind,
        balance: formatCurrency(Math.max(0, total - amountPaid)),
        firstProductName,
        firstProductImage: getReceiptItemImage(items[0]),
        additionalDeviceCount,
        rawOrder,
      } satisfies ReceiptListItem;
    });
}
