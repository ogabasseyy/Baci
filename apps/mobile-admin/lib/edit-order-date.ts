export interface EditOrderDateResolution {
  currentDate?: Date | null;
  hasSavedOrder: boolean;
  savedCreatedAt?: string | null;
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
  savedTransactionDate,
}: EditOrderDateResolution): Date | undefined {
  if (!hasSavedOrder) {
    return currentDate ?? undefined;
  }

  if (!currentDate || Number.isNaN(currentDate.getTime())) {
    return undefined;
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
