import {
  getPaystackDvaAccountNumberFromTransactions,
  selectPreferredOrderPaymentAccount,
} from '@baci/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ORDER_COLUMNS } from '@/lib/order-queries';
import { buildStorefrontAccountDocumentBundle } from '@/lib/storefront-account-document-bundle';
import type {
  StorefrontAccountDocumentCustomerRow,
  StorefrontAccountDocumentItemRow,
  StorefrontAccountDocumentMerchantRow,
  StorefrontAccountDocumentOrderRow,
  StorefrontAccountDocumentPaymentAccountRow,
  StorefrontAccountDocumentTaxSubtotalRow,
  StorefrontAccountDocumentTransactionRow,
} from '@/lib/storefront-account-document-bundle.types';
import { toOrderPaymentAccount } from '@/lib/storefront-customer-payment-account-adapter';
import { loadStorefrontCustomerPaymentAccounts } from '@/lib/storefront-customer-payment-accounts';
import { loadStorefrontCustomerTransactions } from '@/lib/storefront-customer-transactions';

const RECEIPT_READY_STATUSES = new Set(['shipped', 'delivered']);

const MERCHANT_COLUMNS =
  'id, slug, business_name, logo_url, email, phone, support_email, support_phone, rider_phone_number, business_address, cac_rc_number, tax_identification_number, legal_entity_name, brand_colors, vat_registration_status, vat_rate, bank_code, bank_account_number, bank_name, bank_account_name, social_media, pages, registered_address';

const ORDER_SELECT = `${ORDER_COLUMNS}, transaction_date, external_source, import_job_id, is_credit_order, invoice_type_code, invoice_issue_date, tax_point_date, payment_due_date, buyer_reference, purchase_order_reference, tax_exclusive_amount, tax_inclusive_amount, invoice_note, firs_irn, firs_csid, firs_qr_code, payment_terms, shipping_rate_id, shipping_rate_name, shipping_pickup_details`;

interface StorefrontAccountDocumentParams {
  supabase: SupabaseClient;
  userId: string;
  merchantSlug: string;
  orderId: string;
}

export class StorefrontAccountDocumentError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = 'StorefrontAccountDocumentError';
  }
}

export function normalizePaymentStatus(status: string | null | undefined) {
  return status?.trim().toLowerCase().replace(/\s+/g, '_') ?? '';
}

export function normalizeShippingStatus(status: string | null | undefined) {
  return status?.trim().toLowerCase().replace(/\s+/g, '_') ?? '';
}

function isImportedHistoricalOrder(input: {
  externalSource?: string | null;
  importJobId?: string | null;
}) {
  return Boolean(input.externalSource || input.importJobId);
}

export function isReceiptEligible(input: {
  paymentStatus: string | null | undefined;
  shippingStatus: string | null | undefined;
  externalSource?: string | null;
  importJobId?: string | null;
}) {
  if (normalizePaymentStatus(input.paymentStatus) !== 'paid') {
    return false;
  }

  if (isImportedHistoricalOrder(input)) {
    return true;
  }

  return RECEIPT_READY_STATUSES.has(
    normalizeShippingStatus(input.shippingStatus)
  );
}

export function getCurrentDocumentKind(input: {
  paymentStatus: string | null | undefined;
  shippingStatus: string | null | undefined;
  externalSource?: string | null;
  importJobId?: string | null;
}) {
  return isReceiptEligible(input) ? 'receipt' : 'invoice';
}

export async function getStorefrontAccountDocumentData({
  supabase,
  userId,
  merchantSlug,
  orderId,
}: StorefrontAccountDocumentParams) {
  const { data: merchant, error: merchantError } = await supabase
    .from('merchants')
    .select(MERCHANT_COLUMNS)
    .eq('slug', merchantSlug)
    .maybeSingle();

  if (merchantError || !merchant) {
    throw new StorefrontAccountDocumentError(
      'Store not found',
      404,
      'NOT_FOUND'
    );
  }

  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('id, first_name, last_name, email, phone')
    .eq('merchant_id', merchant.id)
    .eq('user_id', userId)
    .maybeSingle();

  if (customerError || !customer) {
    throw new StorefrontAccountDocumentError(
      'Customer not found',
      404,
      'NOT_FOUND'
    );
  }

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select(ORDER_SELECT)
    .eq('id', orderId)
    .eq('merchant_id', merchant.id)
    .eq('customer_id', customer.id)
    .maybeSingle();

  if (orderError || !order) {
    throw new StorefrontAccountDocumentError(
      'Order not found',
      404,
      'NOT_FOUND'
    );
  }

  const [
    itemsResult,
    transactionsResult,
    paymentAccountsResult,
    taxResult,
    canCancelResult,
  ] = await Promise.all([
    supabase
      .from('order_items')
      .select(
        'id, product_id, variant_id, condition, variant_name, name, quantity, price, assurance_fee, line_extension_amount, unit_code, vat_category_code, vat_rate, vat_amount, sellers_item_id, fulfillment_data'
      )
      .eq('order_id', orderId),
    loadStorefrontCustomerTransactions(supabase, [orderId]),
    loadStorefrontCustomerPaymentAccounts(supabase, [orderId]),
    supabase
      .from('order_tax_subtotals')
      .select(
        'vat_category_code, vat_rate, taxable_amount, tax_amount, exemption_reason'
      )
      .eq('order_id', orderId),
    // Authoritative gate for the customer "Cancel Order" CTA. The customer-scoped
    // client cannot read the merchant-only transactions table, so this server RPC
    // is the source of truth. Fail-closed: any error means "not cancellable".
    supabase.rpc('customer_order_can_cancel', { p_order_id: orderId }),
  ]);

  if (
    itemsResult.error ||
    transactionsResult.error ||
    paymentAccountsResult.error ||
    taxResult.error
  ) {
    console.error('Storefront document bundle query failed:', {
      itemsError: itemsResult.error,
      transactionsError: transactionsResult.error,
      paymentAccountsError: paymentAccountsResult.error,
      taxError: taxResult.error,
      merchantSlug,
      orderId,
    });
    throw new StorefrontAccountDocumentError(
      'Failed to load order documents',
      500,
      'DOCUMENT_DATA_ERROR'
    );
  }

  const canCancel = canCancelResult.error
    ? false
    : canCancelResult.data === true;

  const paymentStatus = normalizePaymentStatus(order.payment_status);
  const shippingStatus = normalizeShippingStatus(order.shipping_status);
  const currentDocumentKind = getCurrentDocumentKind({
    paymentStatus: order.payment_status,
    shippingStatus: order.shipping_status,
    externalSource: order.external_source,
    importJobId: order.import_job_id,
  });
  const transactionRows = (transactionsResult.data ||
    []) as StorefrontAccountDocumentTransactionRow[];

  return buildStorefrontAccountDocumentBundle({
    merchant: merchant as StorefrontAccountDocumentMerchantRow,
    customer: customer as StorefrontAccountDocumentCustomerRow,
    order: order as StorefrontAccountDocumentOrderRow,
    itemRows: (itemsResult.data || []) as StorefrontAccountDocumentItemRow[],
    transactions: transactionRows,
    paymentAccount: selectPreferredOrderPaymentAccount(
      paymentAccountsResult.data.map(
        toOrderPaymentAccount
      ) as StorefrontAccountDocumentPaymentAccountRow[],
      new Date(),
      {
        allowExpiredPaystackAccount: paymentStatus === 'paid',
        preferredPaystackAccountNumber:
          paymentStatus === 'paid'
            ? getPaystackDvaAccountNumberFromTransactions(transactionRows)
            : null,
      }
    ),
    taxRows: (taxResult.data ||
      []) as StorefrontAccountDocumentTaxSubtotalRow[],
    paymentStatus,
    shippingStatus,
    currentDocumentKind,
    canCancel,
  });
}
