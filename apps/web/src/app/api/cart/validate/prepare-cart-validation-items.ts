export type CartValidationItem = {
  id: string;
  price: number | null;
  variantId?: string;
  offerId?: string;
};

type RawCartItem = {
  id: string;
  price: number;
  variantId?: string;
  variant_id?: string;
  offerId?: string;
};

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeVariantId(item: RawCartItem | undefined) {
  return item?.variantId || item?.variant_id || undefined;
}

/**
 * Normalizes a validated cart/validate body into validation items plus
 * the id partitions the catalog queries need. Legacy snake_case variant
 * ids fold into variantId (the schema already rejects conflicts);
 * malformed product ids are quarantined for the invalid list instead of
 * reaching the queries.
 */
export function prepareCartValidationItems(
  cartItems: RawCartItem[] | undefined,
  productIds: string[] | undefined
) {
  const hasCartItems = Array.isArray(cartItems) && cartItems.length > 0;
  const validationItems: CartValidationItem[] = hasCartItems
    ? (cartItems as RawCartItem[]).map((item) => ({
        id: item.id,
        price: item.price,
        variantId: normalizeVariantId(item),
        offerId: item.offerId,
      }))
    : ((productIds ?? []) as string[]).map((id) => ({ id, price: null }));

  const validFormatIds: string[] = [];
  const invalidFormatIds: string[] = [];
  const validVariantIds = Array.from(
    new Set(
      validationItems
        .map((item) => item.variantId)
        .filter(
          (variantId): variantId is string =>
            typeof variantId === 'string' && uuidRegex.test(variantId)
        )
    )
  );

  for (const id of validationItems.map((item) => item.id)) {
    const strId = String(id);
    if (uuidRegex.test(strId)) {
      validFormatIds.push(strId);
    } else {
      const safeId = strId.replace(/[\r\n]/g, '').slice(0, 50);
      console.warn(`Cart contains invalid product ID format: "${safeId}"`);
      invalidFormatIds.push(strId);
    }
  }

  return {
    validationItems,
    validFormatIds,
    invalidFormatIds,
    validVariantIds,
  };
}
