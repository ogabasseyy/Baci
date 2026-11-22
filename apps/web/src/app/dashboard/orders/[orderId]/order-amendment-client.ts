import { fetchWithCsrf } from '@/lib/api-client';
import { amendmentErrorSchema } from '@/schemas/order-amendment';

export class AmendmentRequestError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly status?: number
  ) {
    super(message);
  }
}

export async function requestAmendment(
  path: string,
  body?: unknown,
  signal?: AbortSignal
) {
  const response =
    body === undefined
      ? await fetch(path, { cache: 'no-store', signal })
      : await fetchWithCsrf(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
  const data: unknown = await response.json();
  if (!response.ok) {
    const parsed = amendmentErrorSchema.safeParse(data);
    throw new AmendmentRequestError(
      parsed.data?.error ?? 'Unable to load the order change.',
      parsed.data?.code,
      response.status
    );
  }
  return data;
}
