export function formatReceiptDate(dateString: string) {
  const isCalendarDate = /^\d{4}-\d{2}-\d{2}$/.test(dateString);
  return new Date(
    isCalendarDate ? `${dateString}T12:00:00.000Z` : dateString
  ).toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: isCalendarDate ? 'UTC' : 'Africa/Lagos',
  });
}
