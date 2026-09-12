export interface ReceiptMerchant {
  business_name: string | null;
  logo_url: string | null;
  email: string;
  phone: string | null;
  support_email: string | null;
  support_phone: string | null;
  business_address: string | null;
  registered_address?: {
    street?: string | null;
    city?: string | null;
    state?: string | null;
    postal_code?: string | null;
    country?: string | null;
  } | null;
  cac_rc_number: string | null;
  tax_identification_number: string | null;
  legal_entity_name: string | null;
  brand_colors?: { primary: string; background: string; accent: string };
  vat_registration_status: string | null;
  vat_rate: number | null;
  bank_code: string | null;
  bank_account_number: string | null;
  bank_name?: string | null;
  bank_account_name?: string | null;
  social_media?: {
    instagram?: string;
    facebook?: string;
    twitter?: string;
    tiktok?: string;
  } | null;
  pages?: {
    terms?: string;
  } | null;
}

export interface ReceiptFulfillmentDetails {
  imei?: string | null;
  items?: Array<{
    id?: string | null;
    imei?: string | null;
    orderItemId?: string | null;
    order_item_id?: string | null;
    productName?: string | null;
    product_name?: string | null;
    serialNumber?: string | null;
    serial_number?: string | null;
    variantName?: string | null;
    variant_name?: string | null;
  }> | null;
  serialNumber?: string | null;
  serial_number?: string | null;
}

export interface ReceiptOrder {
  order_number: string;
  created_at: string;
  transaction_date?: string | null;
  invoice_issue_date?: string | null;
  currency: string;
  total: number;
  subtotal: number;
  shipping_fee: number;
  tax_amount: number;
  discount_amount: number;
  amount_paid: number;
  balance: number;
  payment_status: string;
  payment_method: string | null;
  is_credit_order?: boolean;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  shipping_address?: {
    address_line1?: string;
    address_line2?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
  } | null;
  virtual_account?: {
    account_number: string;
    bank_name: string;
    account_name: string;
  } | null;
  fulfillment_details?: ReceiptFulfillmentDetails | null;
  items: Array<{
    id?: string | null;
    line_id?: number;
    product_id?: string | null;
    product_name: string;
    name?: string;
    condition?: string | null;
    variant_id?: string | null;
    variant_name?: string | null;
    description?: string | null;
    quantity: number;
    price: number;
    line_extension_amount?: number;
    unit_code?: string | null;
    vat_category_code?: string | null;
    vat_rate?: number | null;
    vat_amount?: number | null;
    sellers_item_id?: string | null;
    /**
     * @deprecated Keep fulfillment identifiers in `fulfillment_details`.
     * These flat fields are read only for legacy order snapshots.
     */
    imei?: string | null;
    /**
     * @deprecated Keep fulfillment identifiers in `fulfillment_details`.
     * These flat fields are read only for legacy order snapshots.
     */
    serial_number?: string | null;
    /**
     * @deprecated Keep fulfillment identifiers in `fulfillment_details`.
     * These flat fields are read only for legacy order snapshots.
     */
    serialNumber?: string | null;
    fulfillment_details?: ReceiptFulfillmentDetails | null;
  }>;
  transactions?: Array<{
    amount: number;
    created_at: string;
    description: string | null;
    metadata: { payment_method?: string } | null;
  }>;
}

export interface ReceiptOptions {
  qrCodeDataUri?: string;
  storeUrl?: string;
  paymentLink?: string;
  svgXml?: string;
}
