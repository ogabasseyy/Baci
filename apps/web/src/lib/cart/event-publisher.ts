export interface CartEventRpcClient {
  rpc(
    name: 'commerce_cart_publish_events',
    args: { p_limit: number; p_worker_id: string }
  ): PromiseLike<{ data: unknown; error: unknown }>;
}
export type CartPublishResult =
  | { ok: true; sent: number; failed: number; deadLettered: number }
  | { ok: false };

/** Send+ack is one SQL transaction; callers never publish row payloads directly. */
export async function publishCartEvents(
  client: CartEventRpcClient,
  workerId: string,
  limit = 50
): Promise<CartPublishResult> {
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50 ||
    !/^[a-zA-Z0-9_-]{1,80}$/.test(workerId)
  )
    return { ok: false };
  try {
    const { data, error } = await client.rpc('commerce_cart_publish_events', {
      p_limit: limit,
      p_worker_id: workerId,
    });
    if (error || typeof data !== 'object' || data === null)
      return { ok: false };
    const result = data as Record<string, unknown>;
    if (
      ![result.sent, result.failed, result.deadLettered].every(
        (value) =>
          typeof value === 'number' &&
          Number.isSafeInteger(value) &&
          value >= 0 &&
          value <= limit
      )
    )
      return { ok: false };
    const sent = result.sent as number;
    const failed = result.failed as number;
    const deadLettered = result.deadLettered as number;
    if (sent + failed > limit || deadLettered > failed) return { ok: false };
    return { ok: true, sent, failed, deadLettered };
  } catch {
    return { ok: false };
  }
}
