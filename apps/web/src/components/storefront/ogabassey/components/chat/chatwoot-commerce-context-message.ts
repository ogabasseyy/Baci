import { chatwootCommerceContextControlSchema } from '@/schemas/chatwoot-commerce-context-control';

const MAX_COMMERCE_MESSAGE_LENGTH = 24_000;

export function readChatwootCommerceContextMessage(
  event: MessageEvent,
  origin: string,
  frame: Window | null
) {
  if (
    !frame ||
    event.origin !== origin ||
    event.source !== frame ||
    typeof event.data !== 'string' ||
    event.data.length > MAX_COMMERCE_MESSAGE_LENGTH
  ) return null;
  const prefix = [
    'baci-commerce-context-request:',
    'baci-commerce-context-ready:',
  ].find((candidate) => event.data.startsWith(candidate));
  if (!prefix) return null;
  try {
    const result = chatwootCommerceContextControlSchema.safeParse({
      event: prefix.slice(0, -1),
      data: JSON.parse(event.data.slice(prefix.length)),
    });
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
