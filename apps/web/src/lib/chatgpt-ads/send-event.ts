import type { ChatgptPaidEvent } from './paid-event';

export async function sendChatgptEvent(
  pixelId: string,
  key: string,
  event: ChatgptPaidEvent,
  signal?: AbortSignal
): Promise<{ success: boolean; error?: string; httpStatus?: number }> {
  try {
    const response = await fetch(
      `https://bzr.openai.com/v1/events?pid=${encodeURIComponent(pixelId)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ integration_source: 'baci', events: [event] }),
        signal: signal ?? AbortSignal.timeout(10_000),
      }
    );
    // Never read or log an error body: providers can echo identifiers or keys.
    return response.ok
      ? { success: true, httpStatus: response.status }
      : {
          success: false,
          httpStatus: response.status,
          error: 'provider_rejected',
        };
  } catch {
    return { success: false, error: 'provider_transport_failed' };
  }
}
