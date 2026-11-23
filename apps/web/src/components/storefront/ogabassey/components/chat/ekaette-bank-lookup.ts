import { chatwootBankBridgeCommandSchema } from '@/schemas/chatwoot-bank-verification';
import { postChatwootBridgeJson } from './chatwoot-bridge-request';

const PREFIX = 'baci-ekaette-bank:';
const ENDPOINT = '/api/storefront/chatwoot/bank-verification';

export function createEkaetteBankLookup(storeSlug = '') {
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
        data.length > 14_000
      ) {
        return;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(data.slice(PREFIX.length));
      } catch {
        return;
      }
      const parsed = chatwootBankBridgeCommandSchema.safeParse(raw);
      if (!parsed.success) return;

      const command = parsed.data;
      pending?.abort();
      const controller = new AbortController();
      pending = controller;
      const timer = setTimeout(() => controller.abort(), 28_000);
      const respond = (result: Record<string, unknown>) => {
        if (pending === controller) {
          post({ requestId: command.requestId, ...result });
        }
      };

      try {
        if (command.action === 'banks') {
          const payload = await postChatwootBridgeJson(
            ENDPOINT,
            {
              action: 'banks',
              conversationId: command.conversationId,
              sessionToken: command.sessionToken,
            },
            storeSlug,
            controller.signal
          );
          if (Array.isArray(payload?.banks)) {
            respond({ status: 'banks', banks: payload.banks });
          } else {
            respond({ status: 'banks_unavailable' });
          }
          return;
        }

        const payload = await postChatwootBridgeJson(
          ENDPOINT,
          {
            action: 'resolve',
            conversationId: command.conversationId,
            sessionToken: command.sessionToken,
            bankCode: command.bankCode,
            accountNumber: command.accountNumber,
            phone: command.phone,
          },
          storeSlug,
          controller.signal
        );
        if (
          typeof payload?.accountName === 'string' &&
          payload.accountName.trim() &&
          typeof payload?.maskedAccountNumber === 'string' &&
          typeof payload?.verificationReference === 'string'
        ) {
          respond({
            status: 'resolved',
            accountName: payload.accountName,
            maskedAccountNumber: payload.maskedAccountNumber,
            verificationReference: payload.verificationReference,
          });
        } else {
          respond({ status: 'resolve_unavailable' });
        }
      } catch {
        respond({
          status:
            command.action === 'banks'
              ? 'banks_unavailable'
              : 'resolve_unavailable',
        });
      } finally {
        clearTimeout(timer);
        if (pending === controller) pending = undefined;
      }
    },
  };
}
