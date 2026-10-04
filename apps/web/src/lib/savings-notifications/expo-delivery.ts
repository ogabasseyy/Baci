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
    return typeof errorTicket.message === 'string' &&
      isRecord(errorTicket.details)
      ? { outcome: 'rejected', ticketId: null }
      : { outcome: 'unknown', ticketId: null };
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

  try {
    const response = await fetch(EXPO_PUSH_ENDPOINT, {
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
    const payload: unknown = await response.json();
    if (response.ok) return readTicket(payload);
    if (
      response.status >= 400 &&
      response.status < 600 &&
      isExpoRequestError(payload)
    ) {
      return { outcome: 'rejected', ticketId: null };
    }
    return { outcome: 'unknown', ticketId: null };
  } catch {
    return { outcome: 'unknown', ticketId: null };
  }
}
