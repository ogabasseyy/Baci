import 'server-only';
import { randomUUID } from 'node:crypto';
import type { AddressBudgetRequest } from '@/schemas/address-budget-request';
import {
  type AddressBudgetReservation,
  addressBudgetReservationSchema,
} from '@/schemas/address-budget-reservation';
import { createAddressBudgetClient } from './scoped-client';

/** An uncertain commit stays consumed; this function never retries or refunds it. */
export async function reserveAddressProviderRequest(
  provider: AddressBudgetRequest['provider'],
  kind: AddressBudgetRequest['kind'],
  apiKey: string
): Promise<AddressBudgetReservation> {
  const reservationId = randomUUID();
  try {
    const client = createAddressBudgetClient({
      provider,
      kind,
      apiKey,
      reservationId,
    });
    const reply = await client
      .rpc('reserve_address_provider_request')
      .abortSignal(AbortSignal.timeout(1500));
    if (reply.error) return { status: 'unavailable' };
    const result = addressBudgetReservationSchema.safeParse(reply.data);
    if (!result.success) return { status: 'unavailable' };
    if (result.data.status === 'reserved') {
      const now = Date.now();
      if (
        result.data.reservationId !== reservationId ||
        result.data.dispatchBefore <= now + 250 ||
        result.data.dispatchBefore > now + 8000
      )
        return { status: 'unavailable' };
    }
    return result.data;
  } catch {
    return { status: 'unavailable' };
  }
}
