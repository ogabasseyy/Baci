import * as Crypto from 'expo-crypto';

export function generateOrderNumber(date: Date) {
  const prefix = 'ORD';
  const datePart = `${String(date.getDate()).padStart(2, '0')}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getFullYear()).slice(-2)}`;
  const randomPart = Crypto.randomUUID()
    .replace(/-/g, '')
    .substring(0, 6)
    .toUpperCase();
  return `${prefix}-${datePart}-${randomPart}`;
}
