import type { PetrockOrderStatus } from '../imei-providers/petrock/petrock.types';

export interface GiftCardWorkerOrder {
  id: string;
  productId: string;
  amountKobo: number;
  status: string;
  providerOrderId?: string;
}

type ProviderReply<T> = { ok: true; data: T } | { ok: false };
type Terminal = 'success' | 'reject';

export interface GiftCardWorkerDependencies {
  read(id: string): Promise<GiftCardWorkerOrder | null>;
  claim(order: GiftCardWorkerOrder): Promise<GiftCardWorkerOrder | null>;
  recordSubmission(id: string, providerOrderId: string | null): Promise<void>;
  recordResult(
    id: string,
    providerOrderId: string,
    status: Terminal,
    sealedReplay: string
  ): Promise<void>;
  verifySupplierPrice(order: GiftCardWorkerOrder): Promise<boolean>;
  submit(
    order: GiftCardWorkerOrder
  ): Promise<ProviderReply<{ orderUuid: string }>>;
  poll(id: string): Promise<
    ProviderReply<{
      orderUuid: string;
      referenceId?: string;
      status: PetrockOrderStatus;
      replay: string;
    }>
  >;
  seal(replay: string, orderId: string): string;
}

export async function runGiftCardWorker(
  input: { mode: 'submit' | 'poll'; orderId: string },
  deps: GiftCardWorkerDependencies
) {
  const order = await deps.read(input.orderId);
  if (!order) return { status: 'not_found' };

  if (input.mode === 'submit') {
    if (order.status !== 'paid') return { status: 'not_claimed' };
    if (!(await deps.verifySupplierPrice(order)))
      return { status: 'price_unverified' };
    const claimed = await deps.claim(order);
    if (!claimed) return { status: 'not_claimed' };
    let providerOrderId: string | null = null;
    try {
      const reply = await deps.submit(claimed);
      if (reply.ok) providerOrderId = reply.data.orderUuid.trim() || null;
    } catch {
      // The database claim fences repeats even if a provider request times out.
    }
    await deps.recordSubmission(claimed.id, providerOrderId);
    return providerOrderId
      ? { status: 'submitted', providerOrderId }
      : { status: 'submission_unknown' };
  }

  if (order.status !== 'submitted' || !order.providerOrderId) {
    return { status: 'not_pollable' };
  }
  const reply = await deps.poll(order.providerOrderId);
  if (!reply.ok) return { status: 'review', reason: 'poll_unverified' };
  if (reply.data.orderUuid !== order.providerOrderId) {
    return { status: 'review', reason: 'order_mismatch' };
  }
  if (!reply.data.referenceId) {
    return { status: 'review', reason: 'missing_reference' };
  }
  if (reply.data.referenceId !== order.id) {
    return { status: 'review', reason: 'reference_mismatch' };
  }
  const { status, replay } = reply.data;
  if (status !== 'success' && status !== 'reject') return { status: 'pending' };
  if (
    typeof replay !== 'string' ||
    (status === 'success' && !replay.trim()) ||
    Buffer.byteLength(replay, 'utf8') > 65536
  ) {
    return { status: 'review', reason: 'invalid_replay' };
  }
  await deps.recordResult(
    order.id,
    order.providerOrderId,
    status,
    deps.seal(replay, order.id)
  );
  return { status: 'captured', providerStatus: status, replay: '[redacted]' };
}
