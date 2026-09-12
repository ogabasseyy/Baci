export function formatReceiptListDate(value: string) {
  const isCalendarDate = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(isCalendarDate ? `${value}T12:00:00.000Z` : value);

  return date.toLocaleDateString(undefined, {
    timeZone: isCalendarDate ? 'UTC' : 'Africa/Lagos',
  });
}
