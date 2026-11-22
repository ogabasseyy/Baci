import { chatwootCheckoutTurnBridgeCommandSchema } from '@/schemas/chatwoot-checkout-turn';
import { postChatwootBridgeJson } from './chatwoot-bridge-request';

const PREFIX = 'baci-ekaette-checkout-turn:';
const ENDPOINT = '/api/storefront/chatwoot/checkout-turn';

export function createEkaetteCheckoutTurnLookup(storeSlug = '') {
  let pending: AbortController | undefined;

  return {
    close() {
      pending?.abort();
      pending = undefined;
    },
    async receive(
      data: unknown,
      post: (result: Record<string, unknown>) => void
    ) {
      if (
        typeof data !== 'string' ||
        !data.startsWith(PREFIX) ||
        data.length > 24_000
      ) {
        return;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(data.slice(PREFIX.length));
      } catch {
        return;
      }
      const parsed = chatwootCheckoutTurnBridgeCommandSchema.safeParse(raw);
      if (!parsed.success) return;

      const command = parsed.data;
      pending?.abort();
      const controller = new AbortController();
      pending = controller;
      const timer = setTimeout(() => controller.abort(), 15_000);
      const respond = (result: Record<string, unknown>) => {
        if (pending === controller) {
          post({ requestId: command.requestId, ...result });
        }
      };

      try {
        const payload = await postChatwootBridgeJson(
          ENDPOINT,
          {
            conversationId: command.conversationId,
            sessionToken: command.sessionToken,
            step: command.step,
            question: command.question,
            answer: command.answer,
            ...(command.options ? { options: command.options } : {}),
          },
          storeSlug,
          controller.signal
        );
        if (typeof payload?.intent === 'string') {
          respond({
            status: 'ok',
            intent: payload.intent,
            ...(typeof payload.selectedCode === 'string'
              ? { selectedCode: payload.selectedCode }
              : {}),
            ...(typeof payload.extractedValue === 'string'
              ? { extractedValue: payload.extractedValue }
              : {}),
            ...(typeof payload.reply === 'string'
              ? { reply: payload.reply }
              : {}),
          });
        } else {
          respond({ status: 'unavailable' });
        }
      } catch {
        respond({ status: 'unavailable' });
      } finally {
        clearTimeout(timer);
        if (pending === controller) pending = undefined;
      }
    },
  };
}
