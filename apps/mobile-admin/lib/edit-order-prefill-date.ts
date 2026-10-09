import { parseCalendarDayToLocalDate } from './edit-order-calendar-day';
import { isManualOrderSource } from './edit-order-manual-source';

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
