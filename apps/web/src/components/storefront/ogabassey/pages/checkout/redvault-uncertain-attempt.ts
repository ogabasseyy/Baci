import type { z } from 'zod';
import { orderCreateSchema } from '@/schemas/orders';
import { redvaultRecoveryCustomerSchema } from '@/schemas/redvault-recovery-customer';
import { redvaultUncertainAttemptSchema } from '@/schemas/redvault-uncertain-attempt';
import type { buildCheckoutOrderRequest } from './build-checkout-order-request';

const prefix = 'baci:uba-uncertain-checkout:';
const MAX_ATTEMPT_LENGTH = 100_000;
type StoredAttempt = z.infer<typeof redvaultUncertainAttemptSchema>;
type ValidatedAttempt = StoredAttempt & {
  parsedOrder: z.infer<typeof orderCreateSchema>;
};

function storageKey(merchantId: string) {
  return `${prefix}${merchantId.toLowerCase()}`;
}

function parseAttempt(raw: string): ValidatedAttempt | null {
  if (raw.length > MAX_ATTEMPT_LENGTH) return null;
  try {
    const attempt = redvaultUncertainAttemptSchema.safeParse(JSON.parse(raw));
    if (!attempt.success) return null;
    const order = orderCreateSchema.safeParse(attempt.data.orderRequest);
    const rawCustomer = redvaultRecoveryCustomerSchema.safeParse(
      attempt.data.orderRequest
    );
    if (
      !order.success ||
      order.data.merchant_id !== attempt.data.merchantId ||
      order.data.payment_method !== 'uba_redvault' ||
      !order.data.shared_cart ||
      !rawCustomer.success ||
      rawCustomer.data.customer_email !== attempt.data.customer.email ||
      rawCustomer.data.customer_name !== attempt.data.customer.name ||
      rawCustomer.data.customer_phone !== attempt.data.customer.phone ||
      order.data.items.some(
        (item) =>
          item.voucherToken ||
          item.voucher_token ||
          item.voucherAwardId ||
          item.voucher_award_id
      )
    ) {
      return null;
    }
    return { ...attempt.data, parsedOrder: order.data };
  } catch {
    return null;
  }
}

/** Keep an unresolved request until its authoritative order fence is durable. */
export function saveRedvaultUncertainAttempt(input: {
  merchantId: string;
  idempotencyKey: string;
  fingerprint: string;
  customer: StoredAttempt['customer'];
  billingAddress: StoredAttempt['billingAddress'];
  orderRequest: ReturnType<typeof buildCheckoutOrderRequest>;
}): void {
  const key = storageKey(input.merchantId);
  let previous: string | null;
  let serialized: string;
  try {
    previous = sessionStorage.getItem(key);
    serialized = JSON.stringify({
      ...input,
      version: 1,
      createdAt: Date.now(),
    });
  } catch {
    throw new Error(
      'UBA checkout recovery is unavailable. Please enable browser storage and try again.'
    );
  }
  const next = parseAttempt(serialized);
  if (!next)
    throw new Error(
      'Unable to save your UBA review. Please check your contact and delivery details.'
    );
  if (previous) {
    const existing = parseAttempt(previous);
    if (
      !existing ||
      existing.idempotencyKey !== next.idempotencyKey ||
      JSON.stringify(existing.orderRequest) !==
        JSON.stringify(next.orderRequest) ||
      existing.fingerprint !== next.fingerprint
    ) {
      throw new Error(
        'A previous UBA checkout still needs attention. Please try again or contact the store.'
      );
    }
  }
  try {
    sessionStorage.setItem(key, serialized);
    if (sessionStorage.getItem(key) !== serialized)
      throw new Error('write failed');
  } catch {
    throw new Error(
      'UBA checkout recovery is unavailable. Please enable browser storage and try again.'
    );
  }
}

export function readRedvaultUncertainAttempt(
  merchantId: string
):
  | { kind: 'none' }
  | { kind: 'unavailable' }
  | { kind: 'pending'; attempt: ValidatedAttempt } {
  try {
    const raw = sessionStorage.getItem(storageKey(merchantId));
    if (!raw) return { kind: 'none' };
    const attempt = parseAttempt(raw);
    return attempt && attempt.merchantId === merchantId
      ? { kind: 'pending', attempt }
      : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}

export function clearRedvaultUncertainAttempt(
  merchantId: string,
  idempotencyKey: string
): void {
  const existing = readRedvaultUncertainAttempt(merchantId);
  if (
    existing.kind === 'pending' &&
    existing.attempt.idempotencyKey === idempotencyKey
  ) {
    sessionStorage.removeItem(storageKey(merchantId));
  }
}
