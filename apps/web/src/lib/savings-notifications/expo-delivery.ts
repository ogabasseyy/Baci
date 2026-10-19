import { savingsNotificationExpoEndpointSchema } from '@/schemas/savings-notification-worker';
import type { SavingsPushInput, SavingsPushResult } from './push-worker';

const EXPO_PUSH_ENDPOINT = savingsNotificationExpoEndpointSchema.parse(
  'https://exp.host/--/api/v2/push/send'
);
const EXPO_REQUEST_TIMEOUT_MS = 8_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readTicket(value: unknown): SavingsPushResult {
  if (!value || typeof value !== 'object') {
    return { outcome: 'unknown', ticketId: null };
  }
  const data = (value as { data?: unknown }).data;
  const ticket = Array.isArray(data)
    ? data.length === 1
      ? data[0]
      : undefined
    : data;
  if (!ticket || typeof ticket !== 'object') {
    return { outcome: 'unknown', ticketId: null };
  }
  const status = (ticket as { status?: unknown }).status;
  if (status === 'error') {
    const errorTicket = ticket as { message?: unknown; details?: unknown };
    if (
      typeof errorTicket.message !== 'string' ||
      !isRecord(errorTicket.details)
    ) {
      return { outcome: 'unknown', ticketId: null };
    }
    // A ticket-level DeviceNotRegistered is definitive: there is no receipt
    // id, so the receipt path can never deactivate this token. Report a
    // distinct outcome so finish_push retires it instead of reselecting it
    // for every future event.
    if (errorTicket.details.error === 'DeviceNotRegistered') {
      return { outcome: 'unregistered', ticketId: null };
    }
    // A ticket-level MessageRateExceeded is transient per-device throttling:
    // retry with backoff via finish_push instead of terminalizing the
    // delivery as rejected.
    if (errorTicket.details.error === 'MessageRateExceeded') {
      return { outcome: 'retryable', ticketId: null };
    }
    return { outcome: 'rejected', ticketId: null };
  }
  const id = (ticket as { id?: unknown }).id;
  if (
    status === 'ok' &&
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= 256
  ) {
    return { outcome: 'accepted', ticketId: id };
  }
  return { outcome: 'unknown', ticketId: null };
}

function isExpoRequestError(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const errors = (value as { errors?: unknown }).errors;
  return (
    Array.isArray(errors) &&
    errors.length > 0 &&
    errors.every(
      (error) =>
        !!error &&
        typeof error === 'object' &&
        typeof (error as { code?: unknown }).code === 'string' &&
        typeof (error as { message?: unknown }).message === 'string'
    )
  );
}

export async function deliverSavingsExpoPush(
  input: SavingsPushInput
): Promise<SavingsPushResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (input.accessToken) {
    headers.Authorization = `Bearer ${input.accessToken}`;
  }

  // Transport failures (timeout, DNS, reset) are transient: classify them
  // retryable so the bounded claim_push path redelivers instead of
  // terminally discarding every notification hit by a network outage.
  let response: Response;
  try {
    response = await fetch(EXPO_PUSH_ENDPOINT, {
      method: 'POST',
      headers,
      redirect: 'error',
      body: JSON.stringify({
        to: input.token,
        title: input.title,
        body: input.body,
        data: input.data,
        sound: 'default',
        channelId: input.channelId,
      }),
      signal: AbortSignal.timeout(EXPO_REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { outcome: 'retryable', ticketId: null };
  }
  try {
    // Classify transient HTTP status before parsing: a 429/5xx from Expo
    // or an intermediary may carry an empty or non-JSON body, and a parse
    // throw here would be recorded as terminal unknown instead of retried.
    if (response.status === 429 || response.status >= 500) {
      try {
        await response.body?.cancel();
      } catch {
        // Ignore body-drain failures; the outcome is already decided.
      }
      return { outcome: 'retryable', ticketId: null };
    }
    const payload: unknown = await response.json();
    if (response.ok) return readTicket(payload);
    // 429/5xx already returned retryable above; only other 4xx responses
    // with a documented Expo error envelope are terminally rejected.
    if (
      isExpoRequestError(payload) &&
      response.status >= 400 &&
      response.status < 500
    ) {
      return { outcome: 'rejected', ticketId: null };
    }
    return { outcome: 'unknown', ticketId: null };
  } catch {
    return { outcome: 'unknown', ticketId: null };
  }
}
