import type { EventDestinationResult } from '@/lib/events/event-destination';
import type { XAdsAuthentication } from '@/schemas/x-ads-settings';
import { createXOAuthHeader } from './oauth-header';
import type { XPaidEvent } from './paid-event';
export async function sendXEvent(
  pixelId: string,
  credentials: XAdsAuthentication,
  event: XPaidEvent,
  signal?: AbortSignal
): Promise<EventDestinationResult> {
  if (!/^[A-Za-z0-9]{1,64}$/.test(pixelId))
    return { success: false, errorCode: 'invalid_destination_payload' };
  const url = `https://ads-api.x.com/12/measurement/conversions/${pixelId}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...('pixelToken' in credentials
          ? { 'X-Pixel-Token': credentials.pixelToken }
          : { Authorization: createXOAuthHeader(url, 'POST', credentials) }),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ conversions: [event] }),
      signal: signal ?? AbortSignal.timeout(10000),
    });
    if (!response.ok)
      return {
        success: false,
        errorCode: 'provider_rejected',
        httpStatus: response.status,
      };
    const receipt: unknown = await response.json();
    const data =
      receipt && typeof receipt === 'object' && 'data' in receipt
        ? receipt.data
        : null;
    if (
      !data ||
      typeof data !== 'object' ||
      !('conversions_processed' in data) ||
      typeof data.conversions_processed !== 'number' ||
      !Number.isInteger(data.conversions_processed) ||
      data.conversions_processed < 1
    )
      return {
        success: false,
        errorCode: 'invalid_provider_receipt',
        requestMayHaveBeenSent: true,
        httpStatus: response.status,
      };
    return {
      success: true,
      httpStatus: response.status,
      terminalOutcome: 'delivered',
      ...('debug_id' in data &&
      typeof data.debug_id === 'string' &&
      /^[A-Za-z0-9_-]{1,128}$/.test(data.debug_id)
        ? { providerResponseId: data.debug_id }
        : {}),
    };
  } catch {
    return {
      success: false,
      errorCode: 'provider_transport_failed',
      requestMayHaveBeenSent: true,
    };
  }
}
