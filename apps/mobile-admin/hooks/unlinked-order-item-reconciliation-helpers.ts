import {
  type AdminProductSearchPage,
  fetchAdminProductSearchRows,
} from '@/lib/product-search';
import { supabase } from '@/lib/supabase';

export interface ProductCandidateRow {
  id: string;
  name: string;
  price: number | null;
  status: string | null;
}

export interface UnlinkedOrderItemRow {
  id: string;
  name: string | null;
  price: number | null;
}

export interface VariantCandidateRow {
  attributes: unknown;
  condition: string | null;
  id: string;
  price_override: number | null;
  products:
    | {
        id: string;
        merchant_id: string;
        name: string;
        price: number | null;
        status: string | null;
      }
    | Array<{
        id: string;
        merchant_id: string;
        name: string;
        price: number | null;
        status: string | null;
      }>
    | null;
}

const RECONCILIATION_PRODUCT_COLUMNS = 'id, name, price, status';
const RECONCILIATION_SEARCH_BATCH_SIZE = 4;
const RECONCILIATION_SEARCH_PAGE_SIZE = 20;

export function getJoinedParent(value: VariantCandidateRow['products']) {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export function buildReconciliationSearchTerms(items: UnlinkedOrderItemRow[]) {
  const terms = new Set<string>();

  for (const item of items) {
    const normalizedName = (item.name ?? '')
      .replace(/\[[^\]]+\]/g, ' ')
      .replace(/\bimei\b[:\s-]*\d+/gi, ' ')
      .replace(/\bserial\b[:\s-]*[\w-]+/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (normalizedName.length >= 2) {
      terms.add(normalizedName);
    }
  }

  return [...terms];
}

export function dedupeProductRows(rows: ProductCandidateRow[]) {
  const productsById = new Map<string, ProductCandidateRow>();
  for (const row of rows) {
    productsById.set(row.id, row);
  }

  return [...productsById.values()];
}

export async function fetchCandidatePagesInBatches(
  searchTerms: string[],
  merchantId: string
) {
  const pages: AdminProductSearchPage<ProductCandidateRow>[] = [];

  for (
    let index = 0;
    index < searchTerms.length;
    index += RECONCILIATION_SEARCH_BATCH_SIZE
  ) {
    const batch = searchTerms.slice(
      index,
      index + RECONCILIATION_SEARCH_BATCH_SIZE
    );
    const batchPages = await Promise.all(
      batch.map((searchTerm) =>
        fetchAdminProductSearchRows<ProductCandidateRow>({
          cursor: 0,
          filters: { includeArchived: true, search: searchTerm },
          merchantId,
          pageSize: RECONCILIATION_SEARCH_PAGE_SIZE,
          selectColumns: RECONCILIATION_PRODUCT_COLUMNS,
        })
      )
    );

    pages.push(...batchPages);
  }

  return pages;
}

export async function fetchUnlinkedOrderItems(merchantId: string) {
  const { data, error } = await supabase
    .from('order_items')
    .select(
      'id, name, price, quantity, cost_price, supplier_name, product_match_status, orders!inner(id, order_number, merchant_id, customer_name, payment_status, created_at)'
    )
    .eq('orders.merchant_id', merchantId)
    .eq('orders.payment_status', 'paid')
    .is('product_id', null)
    .neq('product_match_status', 'custom')
    .order('created_at', { referencedTable: 'orders', ascending: false })
    .limit(100);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as UnlinkedOrderItemRow[];
}
