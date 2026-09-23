import { applyCheckoutCreditSnapshot } from '@/lib/checkout-attempt-credit-snapshot';
import { buildOrderPayload } from './orders.payload';

type BuildOrderPayloadInput = Parameters<typeof buildOrderPayload>[0];

export function buildSnapshottedOrderPayload(
  input: BuildOrderPayloadInput,
  checkoutGeneration: string
): Promise<ReturnType<typeof buildOrderPayload>> {
  return applyCheckoutCreditSnapshot(
    buildOrderPayload(input),
    checkoutGeneration
  );
}
