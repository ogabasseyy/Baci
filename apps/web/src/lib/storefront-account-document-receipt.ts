import type { ReceiptMerchant, ReceiptOrder } from '@baci/shared';
import type {
  StorefrontAccountDocumentMerchantRow,
  StorefrontAccountDocumentOrderRow,
  StorefrontAccountDocumentPaymentAccountRow,
  StorefrontAccountDocumentTransactionRow,
} from '@/lib/storefront-account-document-bundle.types';
import { asNumber, asRecord } from '@/lib/storefront-account-document-values';
import type { StorefrontOrder } from '@/types/storefront-order';

interface BuildReceiptOrderInput {
  order: StorefrontAccountDocumentOrderRow;
  orderItems: StorefrontOrder['items'];
  transactions: StorefrontAccountDocumentTransactionRow[];
  paymentAccount: StorefrontAccountDocumentPaymentAccountRow | null;
  paymentStatus: string;
  shippingAddress: ReceiptOrder['shipping_address'];
  currency: string;
  total: number;
  subtotal: number;
  shippingFee: number;
  taxAmount: number;
  discountAmount: number;
  amountPaid: number;
  balance: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
}

export function buildReceiptMerchant(
  merchant: StorefrontAccountDocumentMerchantRow
): ReceiptMerchant {
  return {
    business_name: merchant.business_name,
    logo_url: merchant.logo_url,
    email: merchant.email || '',
    phone: merchant.phone,
    support_email: merchant.support_email,
    support_phone: merchant.support_phone,
    business_address: merchant.business_address,
    registered_address: asRecord(
      merchant.registered_address
    ) as ReceiptMerchant['registered_address'],
    cac_rc_number: merchant.cac_rc_number,
    tax_identification_number: merchant.tax_identification_number,
    legal_entity_name: merchant.legal_entity_name,
    brand_colors: asRecord(
      merchant.brand_colors
    ) as ReceiptMerchant['brand_colors'],
    vat_registration_status: merchant.vat_registration_status,
    vat_rate: merchant.vat_rate,
    bank_code: merchant.bank_code,
    bank_account_number: merchant.bank_account_number,
    bank_name: merchant.bank_name,
    bank_account_name: merchant.bank_account_name,
    social_media: asRecord(
      merchant.social_media
    ) as ReceiptMerchant['social_media'],
    pages: asRecord(merchant.pages) as ReceiptMerchant['pages'],
  };
}

export function buildReceiptOrder(input: BuildReceiptOrderInput): ReceiptOrder {
  return {
    order_number: input.order.order_number,
    created_at: input.order.created_at,
    transaction_date: input.order.transaction_date ?? null,
    invoice_issue_date: input.order.invoice_issue_date ?? null,
    currency: input.currency,
    total: input.total,
    subtotal: input.subtotal,
    shipping_fee: input.shippingFee,
    tax_amount: input.taxAmount,
    discount_amount: input.discountAmount,
    amount_paid: input.amountPaid,
    balance: input.balance,
    payment_status: input.paymentStatus,
    payment_method: input.order.payment_method,
    is_credit_order: Boolean(input.order.is_credit_order),
    customer_name: input.customerName,
    customer_email: input.customerEmail,
    customer_phone: input.customerPhone,
    shipping_address: input.shippingAddress,
    virtual_account: input.paymentAccount
      ? {
          account_number: input.paymentAccount.account_number,
          bank_name: input.paymentAccount.bank_name || '',
          account_name: input.paymentAccount.account_name || '',
        }
      : null,
    fulfillment_details: input.order.fulfillment_details
      ? (asRecord(
          input.order.fulfillment_details
        ) as ReceiptOrder['fulfillment_details'])
      : null,
    items: input.orderItems.map((item, index) => ({
      id: item.id,
      line_id: index + 1,
      product_id: item.product_id || null,
      product_name: item.product_name || item.name,
      condition: item.condition || null,
      variant_id: item.variant_id || null,
      variant_name: item.variant_name,
      quantity: item.quantity,
      price: item.price,
      line_extension_amount: item.line_extension_amount,
      unit_code: item.unit_code || null,
      vat_category_code: item.vat_category_code || null,
      vat_rate: item.vat_rate ?? null,
      vat_amount: item.vat_amount ?? null,
      sellers_item_id: item.sellers_item_id || null,
      imei: item.imei,
      serial_number: item.serial_number,
      serialNumber: item.serialNumber,
      fulfillment_details: item.fulfillment_details,
    })),
    transactions: input.transactions.map((transaction) => ({
      amount: asNumber(transaction.amount),
      created_at: transaction.created_at,
      description: transaction.description,
      metadata: transaction.metadata,
    })),
  };
}
