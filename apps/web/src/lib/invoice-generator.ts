/**
 * Peppol BIS Billing 3.0 Compliant Invoice Data Model
 *
 * Shared invoice types for:
 * - Peppol BIS Billing 3.0 (55 mandatory fields)
 * - Nigeria FIRS e-invoicing requirements
 * - Nigeria Tax Act 2025 standards
 *
 * References:
 * - https://docs.peppol.eu/poacc/billing/3.0/
 *
 * NOTE: this module defines data shapes only. The single merchant invoice PDF
 * template is the branded receipt renderer in '@/lib/receipt-pdf-generator'
 * (merchant-adaptive colours + logo, with FIRS/VAT compliance fields). Do not
 * add another PDF renderer here — see invoice-generator.test.ts single-template
 * guard.
 */

// UN/ECE Rec 20 Unit Code descriptions
const UNIT_CODE_NAMES: Record<string, string> = {
  EA: 'Each',
  KGM: 'Kilogram',
  GRM: 'Gram',
  MTR: 'Metre',
  LTR: 'Litre',
  MTK: 'Square metre',
  MTQ: 'Cubic metre',
  PCE: 'Piece',
  SET: 'Set',
  PR: 'Pair',
  PK: 'Pack',
  BX: 'Box',
  CT: 'Carton',
  DZN: 'Dozen',
  HUR: 'Hour',
  DAY: 'Day',
  MON: 'Month',
  ANN: 'Year',
};

// VAT Category descriptions
const VAT_CATEGORY_NAMES: Record<string, string> = {
  S: 'Standard rate',
  Z: 'Zero rated',
  E: 'Exempt',
  AE: 'Reverse charge',
  K: 'Intra-community',
  G: 'Export',
  O: 'Outside scope',
};

// Invoice type code descriptions (UNCL 1001)
const INVOICE_TYPE_NAMES: Record<string, string> = {
  '325': 'Proforma Invoice',
  '380': 'Commercial Invoice',
  '381': 'Credit Note',
  '383': 'Debit Note',
  '384': 'Corrected Invoice',
  '386': 'Prepayment Invoice',
  '389': 'Self-billed Invoice',
};

export interface InvoiceLineItem {
  line_id: number;
  product_id?: string;
  name: string;
  description?: string;
  quantity: number;
  unit_code: string;
  price: number;
  line_extension_amount: number;
  vat_category_code?: string;
  vat_rate?: number;
  vat_amount?: number;
  sellers_item_id?: string;
}

export interface TaxSubtotal {
  vat_category_code: string;
  vat_rate: number;
  taxable_amount: number;
  tax_amount: number;
  exemption_reason?: string;
}

export interface MerchantInfo {
  business_name: string;
  legal_entity_name?: string;
  tax_identification_number?: string;
  endpoint_id?: string;
  endpoint_scheme_id?: string;
  cac_rc_number?: string;
  vat_registration_status: string;
  vat_rate: number;
  registered_address?: {
    street?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
  };
  support_email?: string;
  support_phone?: string;
  logo_url?: string;
}

export interface CustomerInfo {
  id?: string;
  name: string;
  email?: string;
  phone?: string;
  endpoint_id?: string;
  endpoint_scheme_id?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
  };
  tax_id?: string;
}

export interface InvoiceData {
  order_id?: string;
  // Document identifiers (BT-1 to BT-3)
  invoice_number: string;
  invoice_type_code: string;
  issue_date: Date;
  tax_point_date?: Date;
  due_date?: Date;

  // Currency (BT-5)
  currency: string;

  // References
  buyer_reference?: string;
  purchase_order_reference?: string;

  // Parties
  merchant: MerchantInfo;
  customer: CustomerInfo;

  // Line items
  items: InvoiceLineItem[];

  // Tax breakdown
  tax_subtotals: TaxSubtotal[];

  // Totals
  subtotal: number;
  tax_exclusive_amount: number;
  tax_amount: number;
  tax_inclusive_amount: number;
  shipping_fee: number;
  discount_amount: number;
  total: number;
  amount_paid?: number;

  // Additional info
  notes?: string;
  payment_terms?: string;
  payment_account?: {
    account_number: string;
    account_name?: string;
    bank_name?: string;
  };

  // FIRS specific (Phase 2)
  firs_irn?: string;
  firs_csid?: string;
  firs_qr_code?: string;
}

export { INVOICE_TYPE_NAMES, UNIT_CODE_NAMES, VAT_CATEGORY_NAMES };
