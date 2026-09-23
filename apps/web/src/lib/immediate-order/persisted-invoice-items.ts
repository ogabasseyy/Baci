import { logger } from '@/lib/logger';
import type { createAdminClient } from '@/lib/supabase/admin';
import {
  getOptionalString,
  getStringRecord,
  type OrderCreateItem,
  toFiniteNumber,
} from './order-item-primitives';

export type ImmediateInvoiceOrderItem = Omit<
  OrderCreateItem,
  'assurance_fee'
> & {
  assurance_fee?: number;
  item_description?: string | null;
  line_extension_amount?: number | null;
  sellers_item_id?: string | null;
  unit_code?: string | null;
  variant_name?: string | null;
  vat_amount?: number | null;
  vat_category_code?: string | null;
  vat_rate?: number | null;
};

type PersistedInvoiceOrderItemRow = {
  assurance_fee?: unknown;
  condition?: unknown;
  has_assurance?: unknown;
  id?: unknown;
  item_description?: unknown;
  line_extension_amount?: unknown;
  name?: unknown;
  price?: unknown;
  product_id?: unknown;
  quantity?: unknown;
  sellers_item_id?: unknown;
  unit_code?: unknown;
  variant_attributes?: unknown;
  variant_id?: unknown;
  variant_name?: unknown;
  vat_amount?: unknown;
  vat_category_code?: unknown;
  vat_rate?: unknown;
};

const PERSISTED_INVOICE_ITEMS_LOOKUP_ATTEMPTS = 3;
const PERSISTED_INVOICE_ITEMS_RETRY_DELAY_MS = 50;

function normalizePersistedInvoiceOrderItems(
  rows: unknown
): ImmediateInvoiceOrderItem[] | null {
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  const normalizedItems = rows
    .map((row): ImmediateInvoiceOrderItem | null => {
      if (!row || typeof row !== 'object') {
        return null;
      }

      const typedRow = row as PersistedInvoiceOrderItemRow;
      const quantity = toFiniteNumber(typedRow.quantity);
      const price = toFiniteNumber(typedRow.price);
      const name = getOptionalString(typedRow.name) ?? 'Product';
      const fallbackIdentifier =
        getOptionalString(typedRow.product_id) ??
        getOptionalString(typedRow.id);

      if (!quantity || quantity <= 0 || price === null || price < 0) {
        return null;
      }

      return {
        condition: getOptionalString(typedRow.condition) ?? undefined,
        id: fallbackIdentifier,
        product_id: getOptionalString(typedRow.product_id),
        productName: undefined,
        name,
        quantity,
        price,
        variant_id: getOptionalString(typedRow.variant_id),
        variantName: undefined,
        variant_attributes: getStringRecord(typedRow.variant_attributes),
        has_assurance: typedRow.has_assurance === true,
        assurance_fee: toFiniteNumber(typedRow.assurance_fee) ?? undefined,
        item_description: getOptionalString(typedRow.item_description) ?? null,
        line_extension_amount: toFiniteNumber(typedRow.line_extension_amount),
        sellers_item_id: getOptionalString(typedRow.sellers_item_id) ?? null,
        unit_code: getOptionalString(typedRow.unit_code) ?? null,
        variant_name: getOptionalString(typedRow.variant_name) ?? undefined,
        vat_amount: toFiniteNumber(typedRow.vat_amount),
        vat_category_code:
          getOptionalString(typedRow.vat_category_code) ?? null,
        vat_rate: toFiniteNumber(typedRow.vat_rate),
      };
    })
    .filter((item): item is ImmediateInvoiceOrderItem => item !== null);

  return normalizedItems.length > 0 ? normalizedItems : null;
}

async function delayPersistedInvoiceItemRetry(attempt: number) {
  await new Promise((resolve) =>
    setTimeout(resolve, attempt * PERSISTED_INVOICE_ITEMS_RETRY_DELAY_MS)
  );
}

export async function loadPersistedInvoiceOrderItems({
  orderId,
  supabase,
}: {
  orderId: string;
  supabase: ReturnType<typeof createAdminClient>;
}) {
  let lastError: unknown = null;

  for (
    let attempt = 1;
    attempt <= PERSISTED_INVOICE_ITEMS_LOOKUP_ATTEMPTS;
    attempt += 1
  ) {
    const { data, error } = await supabase
      .from('order_items')
      .select(
        'id, product_id, variant_id, variant_attributes, variant_name, condition, name, quantity, price, has_assurance, assurance_fee, item_description, line_extension_amount, vat_category_code, vat_rate, vat_amount, sellers_item_id, unit_code'
      )
      .eq('order_id', orderId)
      .order('line_id', { ascending: true });

    if (!error) {
      const normalizedItems = normalizePersistedInvoiceOrderItems(data);
      if (normalizedItems) {
        return normalizedItems;
      }

      lastError = new Error('Persisted invoice items not visible yet');
      if (attempt < PERSISTED_INVOICE_ITEMS_LOOKUP_ATTEMPTS) {
        await delayPersistedInvoiceItemRetry(attempt);
        continue;
      }

      return null;
    }

    lastError = error;
    logger.error({
      message: 'Failed to load persisted order items for invoice email',
      alert: 'invoice_order_items_lookup_failed',
      attempt,
      attempts: PERSISTED_INVOICE_ITEMS_LOOKUP_ATTEMPTS,
      orderId,
      error,
    });

    if (attempt < PERSISTED_INVOICE_ITEMS_LOOKUP_ATTEMPTS) {
      await delayPersistedInvoiceItemRetry(attempt);
    }
  }

  logger.error({
    message: 'Persisted order item lookup exhausted for invoice email',
    alert: 'invoice_order_items_lookup_exhausted',
    attempts: PERSISTED_INVOICE_ITEMS_LOOKUP_ATTEMPTS,
    orderId,
    error: lastError,
  });
  return null;
}
