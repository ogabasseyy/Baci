const ORDER_DATE_FUTURE_TOLERANCE_MS = 60_000;

export function validateOrderDate(orderDate: Date, now: Date) {
  if (Number.isNaN(orderDate.getTime())) {
    throw new Error('Invalid order date');
  }

  if (orderDate.getTime() > now.getTime() + ORDER_DATE_FUTURE_TOLERANCE_MS) {
    throw new Error('Order date cannot be in the future');
  }
}
