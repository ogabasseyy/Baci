type JsonRecord = Record<string, unknown>;

export function mapUcpCheckoutLineItem(lineItem: unknown) {
  const lineItemRecord = isRecord(lineItem) ? lineItem : {};
  const item = getRecord(lineItemRecord.item);
  const quantity =
    toPositiveInteger(lineItemRecord.quantity) ??
    toPositiveInteger(item?.quantity) ??
    1;
  const lineTotal =
    toIntegerAmount(lineItemRecord.total) ??
    toIntegerAmount(lineItemRecord.subtotal) ??
    toIntegerAmount(lineItemRecord.base_amount) ??
    0;
  const unitPriceBasis =
    toIntegerAmount(lineItemRecord.base_amount) ??
    toIntegerAmount(lineItemRecord.subtotal) ??
    lineTotal;
  const unitPrice = Math.max(0, Math.round(unitPriceBasis / quantity));

  return {
    ...lineItemRecord,
    id: toStringValue(lineItemRecord.id) ?? 'unknown',
    item: {
      ...(item ?? {}),
      id:
        toStringValue(item?.id) ??
        toStringValue(lineItemRecord.id) ??
        'unknown',
      price: unitPrice,
      title:
        toStringValue(item?.title) ?? toStringValue(item?.id) ?? 'Unknown item',
    },
    quantity,
    totals: [
      {
        amount: Math.max(
          0,
          toIntegerAmount(lineItemRecord.subtotal) ?? lineTotal
        ),
        display_text: 'Subtotal',
        type: 'subtotal',
      },
      {
        amount: Math.max(0, lineTotal),
        display_text: 'Total',
        type: 'total',
      },
    ],
  };
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getRecord(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null;
}

function toStringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function toIntegerAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric) : null;
}

function toPositiveInteger(value: unknown): number | null {
  const amount = toIntegerAmount(value);
  return amount && amount > 0 ? amount : null;
}
