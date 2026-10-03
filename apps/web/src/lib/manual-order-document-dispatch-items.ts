/** Item rows for the atomic dispatch snapshot (mirrors the mark RPC). */
export interface DispatchOrderItem {
  id: string;
  name: string;
  quantity: number;
  price: number;
  variant_name: string | null;
  condition: string | null;
  item_description: string | null;
  line_id?: number | null;
  unit_code?: string | null;
  line_extension_amount?: number | null;
  vat_category_code?: string | null;
  vat_rate?: number | null;
  vat_amount?: number | null;
  sellers_item_id?: string | null;
}

/**
 * Projects order items into the exact key set the atomic RPC compares
 * server-side (id-sorted, like the RPC's ORDER BY oi.id). New fields must
 * land here, in the sender select/schema, and in the RPC's v_items
 * jsonb_build_object together, or every dispatch aborts as stale. Missing
 * keys normalize to null to match server NULLs.
 */
export function projectDispatchSnapshotItems(
  items: readonly DispatchOrderItem[]
): DispatchOrderItem[] {
  return [...items]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      price: item.price,
      variant_name: item.variant_name,
      condition: item.condition,
      item_description: item.item_description,
      line_id: item.line_id ?? null,
      unit_code: item.unit_code ?? null,
      line_extension_amount: item.line_extension_amount ?? null,
      vat_category_code: item.vat_category_code ?? null,
      vat_rate: item.vat_rate ?? null,
      vat_amount: item.vat_amount ?? null,
      sellers_item_id: item.sellers_item_id ?? null,
    }));
}
