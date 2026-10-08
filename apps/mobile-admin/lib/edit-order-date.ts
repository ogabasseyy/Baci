// Manual-origin channels whose document dates derive from the device-local
// picker day. Keep in sync with the source list in
// 20261008103000_allow_admin_order_date_edit.sql and
// update_transaction_review_details.
const MANUAL_ORDER_SOURCES: ReadonlySet<string> = new Set([
  'manual',
  'staff_entry',
  'physical',
  'instagram',
  'whatsapp',
  'facebook',
  'tiktok',
  'jumia',
  'jiji',
  'konga',
]);

export function isManualOrderSource(
  source: string | null | undefined
): boolean {
  return typeof source === 'string' && MANUAL_ORDER_SOURCES.has(source);
}

export function parseCalendarDayToLocalDate(
  value: string | null | undefined
): Date | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return undefined;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return undefined;
  }

  return parsed;
}

export interface EditOrderPrefillDate {
  invoiceDay?: string | null;
  savedInstant?: string | null;
  source?: string | null;
}

export function resolvePrefillDate({
  invoiceDay,
  savedInstant,
  source,
}: EditOrderPrefillDate): Date | undefined {
  // Manual orders store the intended device-local day explicitly; prefer it
  // over the instant so a different-timezone device shows the picked day
  // instead of its neighbor.
  if (isManualOrderSource(source)) {
    const manualDay = parseCalendarDayToLocalDate(invoiceDay);
    if (manualDay) {
      return manualDay;
    }
  }

  if (typeof savedInstant !== 'string') {
    return undefined;
  }

  const parsed = new Date(savedInstant);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

export interface EditOrderDateResolution {
  currentDate?: Date | null;
  hasSavedOrder: boolean;
  savedCreatedAt?: string | null;
  savedDay?: string | null;
  savedSource?: string | null;
  savedTransactionDate?: string | null;
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function resolveEditOrderDate({
  currentDate,
  hasSavedOrder,
  savedCreatedAt,
  savedDay,
  savedSource,
  savedTransactionDate,
}: EditOrderDateResolution): Date | undefined {
  if (!hasSavedOrder) {
    return undefined;
  }

  if (!currentDate || Number.isNaN(currentDate.getTime())) {
    return undefined;
  }

  // Manual orders compare picked day against the stored explicit day, which
  // is timezone-proof; other orders fall back to device-local comparison.
  if (isManualOrderSource(savedSource)) {
    const savedManualDay = parseCalendarDayToLocalDate(savedDay);
    if (savedManualDay) {
      return isSameLocalDay(currentDate, savedManualDay)
        ? undefined
        : new Date(
            currentDate.getFullYear(),
            currentDate.getMonth(),
            currentDate.getDate()
          );
    }
  }

  const savedDate = new Date(savedTransactionDate ?? savedCreatedAt ?? '');
  if (Number.isNaN(savedDate.getTime())) {
    return undefined;
  }

  if (isSameLocalDay(currentDate, savedDate)) {
    return undefined;
  }

  // The date-mode picker keeps the previous time on Android, which can push
  // a valid calendar-day selection into the future; backdates are day
  // precision, so send local midnight.
  return new Date(
    currentDate.getFullYear(),
    currentDate.getMonth(),
    currentDate.getDate()
  );
}
