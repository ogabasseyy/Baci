import type { OrderPaymentAccountLike } from '@baci/shared';
import { resolveInvoiceTypeCode } from '@/lib/resolve-invoice-type-code';
import { selectReceiptCompletionDate } from '@/lib/resolve-manual-document-receipt-date';
import {
  getCurrentDocumentKind,
  isManualOrder,
  isManualOrderDocumentAvailable,
  isReceiptEligible,
  normalizePaymentStatus,
  normalizeShippingStatus,
} from '@/lib/storefront-account-document-eligibility';
import type { StorefrontCustomerTransaction } from '@/lib/storefront-customer-transactions';

export interface StorefrontOrderListItemInput {
  id: string;
  product_id?: string | null;
  image_url?: string | null;
  name: string;
  condition?: string | null;
  variant_name?: string | null;
  quantity: number;
  price: number;
  has_assurance?: boolean | null;
  assurance_fee?: number | null;
  products?: JoinedProduct | JoinedProduct[] | null;
}

export interface StorefrontOrderListRowInput {
  id: string;
  order_number?: string | null;
  created_at?: string | null;
  transaction_date?: string | null;
  invoice_issue_date?: string | null;
  total?: number | null;
  subtotal?: number | null;
  shipping_fee?: number | null;
  tax_amount?: number | null;
  discount_amount?: number | null;
  amount_paid?: number | null;
  currency?: string | null;
  external_source?: string | null;
  import_job_id?: string | null;
  recorded_by_user_id?: string | null;
  payment_status?: string | null;
  shipping_status?: string | null;
  shipping_address?: unknown;
  tracking_number?: string | null;
  shipping_provider?: string | null;
  payment_method?: string | null;
  invoice_type_code?: string | null;
  fulfillment_details?: unknown;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  order_items?: readonly StorefrontOrderListItemInput[] | null;
}

export interface StorefrontOrderListLookups {
  transactionsByOrderId: ReadonlyMap<
    string,
    readonly StorefrontCustomerTransaction[]
  >;
  paymentAccountsByOrderId: ReadonlyMap<string, OrderPaymentAccountLike | null>;
}

interface JoinedProduct {
  slug?: string;
  category?: string | null;
  category_slug?: string | null;
  images?: unknown;
  categories?:
    | { name?: string; slug?: string }[]
    | { name?: string; slug?: string }
    | null;
}

function extractJoinedProduct(
  products: JoinedProduct | JoinedProduct[] | null | undefined
) {
  return Array.isArray(products) ? products[0] || null : products || null;
}

function extractProductImages(product: JoinedProduct | null) {
  if (!Array.isArray(product?.images)) {
    return [];
  }

  return product.images.filter(
    (image): image is string => typeof image === 'string' && image.trim() !== ''
  );
}

function normalizeImageUrl(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Projects customer order rows into the storefront account-list shape. */
export function transformStorefrontOrdersForDisplay(
  orders: readonly StorefrontOrderListRowInput[],
  lookups: StorefrontOrderListLookups
) {
  return orders.map((order) => {
    const paymentStatus = normalizePaymentStatus(order.payment_status);
    const shippingStatus = normalizeShippingStatus(order.shipping_status);
    const documentEligibility = {
      paymentStatus,
      shippingStatus,
      externalSource: order.external_source,
      importJobId: order.import_job_id,
      recordedByUserId: order.recorded_by_user_id,
      total: order.total,
      amountPaid: order.amount_paid,
      money: {
        total: order.total,
        subtotal: order.subtotal,
        shipping_fee: order.shipping_fee,
        tax_amount: order.tax_amount,
        discount_amount: order.discount_amount,
        amount_paid: order.amount_paid,
        currency: order.currency,
      },
      items: order.order_items ?? [],
    };
    // A fully-covered manual balance is a receipt in substance even under
    // a non-paid label; resolve the type code from the same boolean so a
    // settled order never pairs kind 'receipt' with a proforma code.
    const receiptEligible = isReceiptEligible(documentEligibility);

    return {
      id: order.id,
      order_number: order.order_number,
      created_at: order.created_at,
      transaction_date: order.transaction_date,
      invoice_issue_date: order.invoice_issue_date,
      // Canonical paid-receipt date (null only when no completion transaction).
      receipt_completion_date: selectReceiptCompletionDate(
        lookups.transactionsByOrderId.get(order.id)
      ),
      // Settled payment history for the preview Payment table: mirrors the
      // sender filter so partial manual invoices show the same payments as
      // the emailed document. The RPC exposes no payment_method, so rows
      // render by description like the generator fallback.
      transactions: (lookups.transactionsByOrderId.get(order.id) ?? [])
        .filter(
          (transaction) =>
            transaction.transaction_type === 'payment' &&
            (transaction.status === 'completed' ||
              transaction.status === 'success')
        )
        .map((transaction) => ({
          amount: Number(transaction.amount ?? 0),
          created_at: transaction.created_at,
          description: transaction.description,
          metadata: null,
        })),
      total: order.total,
      subtotal: order.subtotal,
      shipping_fee: order.shipping_fee,
      tax_amount: order.tax_amount,
      discount_amount: order.discount_amount,
      amount_paid: order.amount_paid,
      currency: order.currency,
      payment_status: paymentStatus,
      shipping_status: shippingStatus,
      shipping_address: order.shipping_address,
      tracking_number: order.tracking_number,
      shipping_provider: order.shipping_provider,
      payment_method: order.payment_method,
      fulfillment_details: order.fulfillment_details,
      customer_name: order.customer_name,
      customer_email: order.customer_email,
      customer_phone: order.customer_phone,
      virtual_account: lookups.paymentAccountsByOrderId.get(order.id) ?? null,
      balance: Math.max(
        0,
        Number(order.total || 0) - Number(order.amount_paid || 0)
      ),
      current_document_kind: getCurrentDocumentKind(documentEligibility),
      invoice_type_code: resolveInvoiceTypeCode({
        paymentMethod: order.payment_method,
        isPaid: paymentStatus === 'paid' || receiptEligible,
        wasPaid: paymentStatus === 'refunded',
        paymentStatus,
        amountPaid: order.amount_paid,
        storedTypeCode: order.invoice_type_code,
      }),
      receipt_eligible: receiptEligible,
      manual_document_available:
        isManualOrderDocumentAvailable(documentEligibility),
      // Staff-recorded marker without the staff identity: lets archive
      // filters fail invalid manual orders closed before legacy branches.
      is_manual_order: isManualOrder(documentEligibility),
      items: (order.order_items || []).map((item) => {
        const product = extractJoinedProduct(item.products);
        const productImages = extractProductImages(product);
        const itemImageUrl =
          normalizeImageUrl(item.image_url) || productImages[0] || undefined;
        const primaryCategory = Array.isArray(product?.categories)
          ? product.categories[0] || null
          : product?.categories || null;

        return {
          id: item.id,
          product_id: item.product_id,
          image_url: itemImageUrl,
          product_images: productImages.length > 0 ? productImages : undefined,
          name: item.name,
          condition: item.condition,
          variant_name: item.variant_name,
          quantity: item.quantity,
          price: item.price,
          has_assurance: item.has_assurance,
          assurance_fee: item.assurance_fee,
          product_slug: product?.slug,
          category: product?.category,
          category_slug: primaryCategory?.slug,
          categories: primaryCategory,
        };
      }),
    };
  });
}
