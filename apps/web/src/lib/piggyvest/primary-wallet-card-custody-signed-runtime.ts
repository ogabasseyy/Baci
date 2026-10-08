import 'server-only';
import { createPrimaryCardCustodyInbox } from './primary-wallet-card-custody-inbox';
import { readPrimaryCardCustodyInboxRuntime } from './primary-wallet-card-custody-inbox-runtime';
import type { createPrimaryCardCustodyReader } from './primary-wallet-card-custody-reader';

export function createPrimaryCardCustodySignedRuntime(input: {
  fetchImplementation: typeof fetch;
  resolveAuthenticatedCrosswalk: Parameters<
    typeof createPrimaryCardCustodyReader
  >[0]['resolveAuthenticatedCrosswalk'];
  environment?: NodeJS.ProcessEnv;
  now?: () => number;
}) {
  const config = readPrimaryCardCustodyInboxRuntime(
    input.environment,
    (input.now ?? Date.now)()
  );
  const inbox = config
    ? createPrimaryCardCustodyInbox({ ...input, configuration: config })
    : null;
  const response = (body: Record<string, boolean | string>, status: number) =>
    Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  return {
    async readiness() {
      if (!inbox)
        return {
          ready: false as const,
          reason: 'configuration_unavailable' as const,
        };
      const ready = await inbox.readiness();
      return ready.ready
        ? { ready: true as const }
        : { ready: false as const, reason: 'capability_unavailable' as const };
    },
    async handleWebhook(
      rawBody: Uint8Array,
      signature: string | null
    ): Promise<Response | null> {
      if (!inbox)
        return response(
          {
            error: 'Signed custody unavailable',
            code: 'PRIMARY_CARD_NOT_READY',
          },
          503
        );
      try {
        const outcome = await inbox.acceptSigned(rawBody, signature);
        if (outcome === 'not_handled') return null;
        if (outcome === 'accepted' || outcome === 'duplicate')
          return response(
            {
              received: true,
              custodyQueued: true,
              duplicate: outcome === 'duplicate',
            },
            200
          );
        if (outcome === 'conflict')
          return response({ received: true, quarantined: true }, 200);
        return response(
          {
            error: 'Signed custody unavailable',
            code: 'PRIMARY_CARD_NOT_READY',
          },
          503
        );
      } catch {
        return response(
          {
            error: 'Signed custody intake unavailable',
            code: 'PRIMARY_CARD_INBOX_ERROR',
          },
          503
        );
      }
    },
    async runWorker(signal?: AbortSignal) {
      if (!inbox) throw new Error('Signed custody configuration unavailable');
      return await inbox.drain(signal);
    },
  };
}
