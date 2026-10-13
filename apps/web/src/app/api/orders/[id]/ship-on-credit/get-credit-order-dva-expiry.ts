const CREDIT_ORDER_DVA_TERM_DAYS = 14;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export function getCreditOrderDvaExpiry(
  paymentDueDate: string | null | undefined,
  now = new Date()
) {
  const dueDateMatch = paymentDueDate?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dueDateMatch) {
    const dueDate = new Date(`${paymentDueDate}T00:00:00.000Z`);
    const [year, month, day] = dueDateMatch.slice(1).map(Number);
    const isValidDueDate =
      Number.isFinite(dueDate.getTime()) &&
      dueDate.getUTCFullYear() === year &&
      dueDate.getUTCMonth() + 1 === month &&
      dueDate.getUTCDate() === day;
    const dueDateExpiry = new Date(dueDate.getTime() + MILLISECONDS_PER_DAY);

    if (isValidDueDate && dueDateExpiry.getTime() > now.getTime()) {
      return dueDateExpiry.toISOString();
    }
  }

  return new Date(
    now.getTime() + CREDIT_ORDER_DVA_TERM_DAYS * MILLISECONDS_PER_DAY
  ).toISOString();
}
