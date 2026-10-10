import { normalizeVariantAttributes } from '@/lib/product-picker-variant-rows';
import { getJoinedRecord } from '@/lib/supabase-utils';

interface OrderItemRow {
  offer_id?: string | null;
  offer_grade?: string | null;
  offer_condition_notes?: string | null;
  offer_labels_snapshotted?: boolean | null;
  condition: string | null;
  has_assurance: boolean | null;
  id: string;
  image_url: string | null;
  item_description: string | null;
  name: string | null;
  price: number;
  product_match_status: 'custom' | 'linked' | 'unreviewed' | null;
  product_id: string | null;
  products:
    | {
        categories:
          | {
              name: string | null;
              slug: string | null;
            }
          | Array<{
              name: string | null;
              slug: string | null;
            }>
          | null;
        category: string | null;
        condition: string | null;
        images: string[] | null;
        name: string;
      }
    | Array<{
        categories:
          | {
              name: string | null;
              slug: string | null;
            }
          | Array<{
              name: string | null;
              slug: string | null;
            }>
          | null;
        category: string | null;
        condition: string | null;
        images: string[] | null;
        name: string;
      }>
    | null;
  quantity: number;
  variant_attributes: unknown;
  variant_id: string | null;
  variant_name: string | null;
}

export function mapOrderItems(items: OrderItemRow[] | null | undefined) {
  return (items ?? []).map((item) => {
    const product = getJoinedRecord(item.products);
    const productCategory = getJoinedRecord(product?.categories);
    const itemName = item.name ?? product?.name ?? 'Unnamed item';
    const categoryName =
      productCategory?.name ?? product?.category ?? undefined;

    return {
      category: categoryName,
      category_slug: productCategory?.slug ?? undefined,
      condition: item.condition ?? undefined,
      details: item.item_description ?? undefined,
      display_condition: item.condition ?? product?.condition ?? undefined,
      display_image_url: item.image_url ?? product?.images?.[0],
      has_assurance: item.has_assurance ?? undefined,
      id: item.id,
      image_url: item.image_url ?? undefined,
      name: itemName,
      offer_id: item.offer_id ?? undefined,
      offer_grade: item.offer_grade ?? undefined,
      offer_condition_notes: item.offer_condition_notes ?? undefined,
      offer_labels_snapshotted: item.offer_labels_snapshotted ?? undefined,
      price: item.price,
      product_id: item.product_id ?? null,
      product_match_status: item.product_match_status ?? undefined,
      product_name: itemName,
      quantity: item.quantity,
      variant_attributes:
        normalizeVariantAttributes(item.variant_attributes) ?? undefined,
      variant_id: item.variant_id ?? null,
      variant_name: item.variant_name ?? undefined,
    };
  });
}

type OfferLabelRow = {
  offer_id?: unknown;
  grade?: unknown;
  condition_notes?: unknown;
};

function hasOfferLabelSnapshot(item: {
  offer_grade?: string | null;
  offer_condition_notes?: string | null;
  offer_labels_snapshotted?: boolean | null;
}) {
  // The marker distinguishes snapshotted-but-empty labels (an offer with
  // neither grade nor notes at purchase) from pre-snapshot legacy rows:
  // without it a later merchant edit would leak live labels into
  // history. Stored labels alone still count for rows selected before
  // the marker column existed.
  return (
    item.offer_labels_snapshotted === true ||
    (typeof item.offer_grade === 'string' && item.offer_grade !== '') ||
    (typeof item.offer_condition_notes === 'string' &&
      item.offer_condition_notes !== '')
  );
}

/**
 * Attach the purchased offer's grade/notes to mapped order items. Lines
 * created after the label snapshot carry their creation-time labels and
 * display them verbatim — the merchant may since have edited the offer
 * or marked it inactive/sold out, and the live catalog row must not
 * rewrite history. The snapshotted marker (not label presence) decides:
 * a marked line with empty labels stays empty rather than consulting
 * live data. Only unmarked pre-snapshot lines fall back to the
 * shopper-safe get_product_offers RPC (one lookup per distinct
 * product). Fail-soft: offer lines keep their persisted condition and
 * ref when the lookup fails.
 */
type AttachedOfferLabelItem<TItem> = TItem & {
  offer_grade?: string;
  offer_condition_notes?: string;
};

export async function attachOrderItemOfferLabels<
  TItem extends {
    offer_id?: string;
    offer_grade?: string | null;
    offer_condition_notes?: string | null;
    offer_labels_snapshotted?: boolean | null;
    product_id?: string | null;
  },
>(
  items: TItem[],
  fetchOffers: (productId: string) => Promise<{
    data: OfferLabelRow[] | null;
    error: unknown;
  }>
): Promise<AttachedOfferLabelItem<TItem>[]> {
  const offerItems = items.filter(
    (item): item is TItem & { offer_id: string; product_id: string } =>
      typeof item.offer_id === 'string' &&
      item.offer_id !== '' &&
      typeof item.product_id === 'string' &&
      item.product_id !== ''
  );
  if (offerItems.length === 0) {
    return items as AttachedOfferLabelItem<TItem>[];
  }

  // Snapshot lines never consult the mutable catalog row: their stored
  // labels are the creation-time truth even when the live offer changed
  // grade/notes or left the active set.
  const lookupItems = offerItems.filter((item) => !hasOfferLabelSnapshot(item));

  const productIds = Array.from(
    new Set(lookupItems.map((item) => item.product_id))
  );
  let labels = new Map<string, { grade?: string; notes?: string }>();
  try {
    // Bounded batches like the order verifiers: a large order must not
    // fan out an unbounded burst of parallel offer RPCs.
    const results: {
      productId: string;
      data: OfferLabelRow[] | null;
      error: unknown;
    }[] = [];
    for (let index = 0; index < productIds.length; index += 10) {
      const batch = await Promise.all(
        productIds.slice(index, index + 10).map(async (productId) => ({
          productId,
          ...(await fetchOffers(productId)),
        }))
      );
      results.push(...batch);
    }
    if (results.some((result) => result.error)) {
      return items as AttachedOfferLabelItem<TItem>[];
    }
    labels = new Map(
      results.flatMap((result) =>
        (result.data ?? []).flatMap((row) =>
          typeof row?.offer_id === 'string'
            ? [
                [
                  `${result.productId}::${row.offer_id}`,
                  {
                    grade:
                      typeof row.grade === 'string' ? row.grade : undefined,
                    notes:
                      typeof row.condition_notes === 'string'
                        ? row.condition_notes
                        : undefined,
                  },
                ] as const,
              ]
            : []
        )
      )
    );
  } catch {
    return items as AttachedOfferLabelItem<TItem>[];
  }

  return items.map((item) => {
    if (
      typeof item.offer_id !== 'string' ||
      typeof item.product_id !== 'string'
    ) {
      return item as AttachedOfferLabelItem<TItem>;
    }
    if (hasOfferLabelSnapshot(item)) {
      // Stored snapshot wins verbatim: normalize nulls without ever
      // merging in live catalog values.
      return {
        ...item,
        offer_grade:
          typeof item.offer_grade === 'string' && item.offer_grade !== ''
            ? item.offer_grade
            : undefined,
        offer_condition_notes:
          typeof item.offer_condition_notes === 'string' &&
          item.offer_condition_notes !== ''
            ? item.offer_condition_notes
            : undefined,
      };
    }
    const label = labels.get(`${item.product_id}::${item.offer_id}`);
    if (!label) return item as AttachedOfferLabelItem<TItem>;
    return {
      ...item,
      offer_grade: label.grade,
      offer_condition_notes: label.notes,
    };
  });
}
