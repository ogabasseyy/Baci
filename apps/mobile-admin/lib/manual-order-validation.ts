import * as Crypto from 'expo-crypto';

const ORDER_DATE_FUTURE_TOLERANCE_MS = 60_000;

export function validateOrderDate(orderDate: Date, now: Date) {
  if (Number.isNaN(orderDate.getTime())) {
    throw new Error('Invalid order date');
  }

  if (orderDate.getTime() > now.getTime() + ORDER_DATE_FUTURE_TOLERANCE_MS) {
    throw new Error('Order date cannot be in the future');
  }
}

export function generateOrderNumber(date: Date) {
  const prefix = 'ORD';
  const datePart = `${String(date.getDate()).padStart(2, '0')}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getFullYear()).slice(-2)}`;
  const randomPart = Crypto.randomUUID()
    .replace(/-/g, '')
    .substring(0, 6)
    .toUpperCase();
  return `${prefix}-${datePart}-${randomPart}`;
}
