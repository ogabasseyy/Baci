import { parseCalendarDayToLocalDate } from './edit-order-calendar-day';
import { isManualOrderSource } from './edit-order-manual-source';

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

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
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

  // Manual orders compare the picked day against the stored explicit day,
  // which is timezone-proof; other orders fall back to device-local
  // comparison. Same-day pairs omit: backdates are day precision, so an
  // intraday time difference alone is intentionally not sent.
  if (isManualOrderSource(savedSource)) {
    const savedManualDay = parseCalendarDayToLocalDate(savedDay);
    if (savedManualDay) {
      return isSameLocalDay(currentDate, savedManualDay)
        ? undefined
        : startOfLocalDay(currentDate);
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
  return startOfLocalDay(currentDate);
}
