import type { ReceiptMerchant } from '@baci/shared';
import { showMerchantBankDetails } from '@/lib/show-merchant-bank-details';

function toReceiptRecord<T>(value: unknown): T | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as T;
}

export interface ImmediateInvoiceMerchantRow {
  bank_account_name?: string | null;
  bank_account_number?: string | null;
  bank_code?: string | null;
  bank_name?: string | null;
  brand_colors?: unknown;
  business_address?: string | null;
  business_name?: string | null;
  cac_rc_number?: string | null;
  email?: string | null;
  legal_entity_name?: string | null;
  logo_url?: string | null;
  pages?: unknown;
  phone?: string | null;
  registered_address?: unknown;
  social_media?: unknown;
  support_email?: string | null;
  support_phone?: string | null;
  tax_identification_number?: string | null;
  vat_rate?: number | null;
  vat_registration_status?: string | null;
}

export function buildImmediateInvoiceMerchant(
  merchant: ImmediateInvoiceMerchantRow,
  orderCurrency: string
): ReceiptMerchant {
  // Foreign-currency invoices skip NGN-only DVA provisioning; the
  // merchant-bank fallback must go with it, or the PDF prints a naira
  // account beside a dollar amount under Payment Instructions.
  const showBankDetails = showMerchantBankDetails(orderCurrency);
  return {
    business_name: merchant.business_name || null,
    logo_url: merchant.logo_url || null,
    email: merchant.email || merchant.support_email || '',
    phone: merchant.phone || null,
    support_email: merchant.support_email || null,
    support_phone: merchant.support_phone || null,
    business_address: merchant.business_address || null,
    registered_address: toReceiptRecord<ReceiptMerchant['registered_address']>(
      merchant.registered_address
    ),
    cac_rc_number: merchant.cac_rc_number || null,
    tax_identification_number: merchant.tax_identification_number || null,
    legal_entity_name: merchant.legal_entity_name || null,
    brand_colors: toReceiptRecord<ReceiptMerchant['brand_colors']>(
      merchant.brand_colors
    ),
    vat_registration_status: merchant.vat_registration_status || null,
    vat_rate: merchant.vat_rate ?? null,
    bank_code: showBankDetails ? merchant.bank_code || null : null,
    bank_account_number: showBankDetails
      ? merchant.bank_account_number || null
      : null,
    bank_name: showBankDetails ? merchant.bank_name || null : null,
    bank_account_name: showBankDetails
      ? merchant.bank_account_name || null
      : null,
    social_media: toReceiptRecord<ReceiptMerchant['social_media']>(
      merchant.social_media
    ),
    pages: toReceiptRecord<ReceiptMerchant['pages']>(merchant.pages),
  };
}
