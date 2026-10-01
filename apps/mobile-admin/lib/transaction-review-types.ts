export interface TransactionReviewProductRow {
  cost_price: number | null;
  fulfillment_details: unknown;
  metadata: Record<string, unknown> | null;
  sku: string | null;
}

export interface TransactionReviewVariantRow {
  attributes: unknown;
  condition: string | null;
  cost_price: number | null;
  sku: string | null;
}

export interface TransactionReviewUnitCostRow {
  cost_price: number | null;
  identifier_type?: 'imei' | 'serial' | string | null;
  identifier_value?: string | null;
  supplier_name: string | null;
  unit_index: number | null;
}

export interface TransactionReviewOrderRow {
  cancelled_at?: string | null;
  created_at: string;
  ad_tracking?: unknown;
  discount_amount?: number | null;
  discount_code_id?: string | null;
  tax_amount?: number | string | null;
  external_source?: string | null;
  source?: string | null;
  transaction_date?: string | null;
  customer_email: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  fulfillment_details: unknown;
  id: string;
  order_items: Array<{
    cost_price?: number | null;
    assurance_fee?: number | string | null;
    condition?: string | null;
    fulfillment_data: unknown;
    id: string;
    line_id?: number | string | null;
    name: string | null;
    order_item_unit_costs?: TransactionReviewUnitCostRow[] | null;
    price: number | null;
    product_id: string | null;
    product_match_status?: 'custom' | 'linked' | 'unreviewed' | null;
    quiz_award_id?: string | null;
    quiz_award_amount?: number | string | null;
    product_variants?:
      | TransactionReviewVariantRow
      | TransactionReviewVariantRow[]
      | null;
    products:
      | TransactionReviewProductRow
      | TransactionReviewProductRow[]
      | null;
    quantity: number | null;
    supplier_name?: string | null;
    vat_category_code?: string | null;
    vat_rate?: number | string | null;
    variant_attributes?: Record<string, string> | null;
    variant_id?: string | null;
  }> | null;
  order_number: string | null;
  payment_method: string | null;
  shipping_status?: string | null;
  total: number | null;
}

export interface TransactionReviewItem {
  costPrice: number | null;
  costSource: 'unit' | 'order_item' | 'variant' | 'product' | null;
  id: string;
  identifierType?: 'imei' | 'serial' | null;
  identifierValue?: string | null;
  imeiValues: string[];
  name: string;
  orderItemId?: string;
  productId: string | null;
  productMatchStatus?: 'custom' | 'linked' | 'unreviewed' | null;
  profit: number | null;
  quantity: number;
  revenue: number;
  searchText: string;
  serialValues: string[];
  sku: string | null;
  supplierName: string;
  unitIndex?: number;
  variantId: string | null;
}

export interface TransactionReviewOrder {
  createdAt: string;
  customerEmail: string | null;
  customerName: string;
  customerPhone: string | null;
  discountAmount?: number;
  estimatedProfit: number;
  id: string;
  items: TransactionReviewItem[];
  missingCostCount: number;
  orderNumber: string;
  paymentMethod: string;
  searchText: string;
  total: number;
}
