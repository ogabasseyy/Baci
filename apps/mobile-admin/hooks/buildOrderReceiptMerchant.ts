import { type ReceiptMerchant, resolveMerchantBankName } from '@baci/shared';
import { queryClient } from '@/lib/query-client';
import { paystackBanksQueryOptions } from './usePaystackBanks';

export interface ReceiptMerchantDetails {
  bank_account_name?: string | null;
  bank_account_number?: string | null;
  bank_code?: string | null;
  bank_name?: string | null;
  registered_address?: ReceiptMerchant['registered_address'];
  brand_colors?: ReceiptMerchant['brand_colors'];
  business_address?: string | null;
  business_name?: string | null;
  cac_rc_number?: string | null;
  email?: string | null;
  id: string;
  legal_entity_name?: string | null;
  logo_url?: string | null;
  pages?: Record<string, unknown> | null;
  phone?: string | null;
  social_media?: ReceiptMerchant['social_media'];
  support_email?: string | null;
  support_phone?: string | null;
  tax_identification_number?: string | null;
  vat_rate?: number | null;
  vat_registration_status?: string | null;
}

/** Keep the verified bank directory lookup separate from automatic DVA selection. */
export async function buildOrderReceiptMerchant(
  merchant: ReceiptMerchantDetails,
  logoUrl: string | null,
  pages: ReceiptMerchant['pages'],
  showPaymentInstructions: boolean
): Promise<ReceiptMerchant> {
  let bankName = resolveMerchantBankName(
    merchant.bank_name,
    merchant.bank_code
  );
  if (
    !bankName &&
    showPaymentInstructions &&
    merchant.bank_code &&
    merchant.bank_account_number
  ) {
    const options = paystackBanksQueryOptions(3000);
    const banks = await queryClient
      .fetchQuery({ ...options, retry: false })
      .catch(() => undefined);
    bankName = resolveMerchantBankName(
      banks?.find((bank) => bank.code === merchant.bank_code)?.name,
      merchant.bank_code
    );
  }
  return {
    bank_account_number: merchant.bank_account_number ?? null,
    bank_code: merchant.bank_code ?? null,
    bank_name: bankName,
    bank_account_name: merchant.bank_account_name ?? null,
    registered_address: merchant.registered_address ?? null,
    brand_colors: merchant.brand_colors ?? undefined,
    business_address: merchant.business_address ?? null,
    business_name: merchant.business_name || 'Baci',
    cac_rc_number: merchant.cac_rc_number ?? null,
    email: merchant.email || '',
    legal_entity_name: merchant.legal_entity_name ?? null,
    logo_url: logoUrl,
    pages,
    phone: merchant.phone ?? null,
    social_media: merchant.social_media ?? null,
    support_email: merchant.support_email ?? null,
    support_phone: merchant.support_phone ?? null,
    tax_identification_number: merchant.tax_identification_number ?? null,
    vat_rate: merchant.vat_rate ?? null,
    vat_registration_status: merchant.vat_registration_status ?? null,
  };
}
