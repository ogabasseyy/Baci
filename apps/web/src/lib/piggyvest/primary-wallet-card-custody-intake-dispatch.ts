import 'server-only';
import { primaryCardCustodyInboxSchemas as schemas } from '@/schemas/primary-wallet-card-custody-inbox';
import { createPrimaryCardCustodyExecutor } from './primary-wallet-card-custody-executor';
import { createPrimaryCardCustodyInboxIntake } from './primary-wallet-card-custody-inbox-intake';
import { readPrimaryCardCustodyIntakeRuntime } from './primary-wallet-card-custody-intake-runtime';

type IntakeResult =
  | { outcome: 'disabled' | 'not_handled'; response: null }
  | {
      outcome:
        | 'accepted'
        | 'duplicate'
        | 'conflict'
        | 'not_ready'
        | 'invalid_signature'
        | 'invalid_payload'
        | 'storage_unavailable';
      response: Response;
    };

export async function dispatchPrimaryCardSignedCustodyIntake(input: {
  rawBody: Uint8Array;
  signature: string | null;
  environment?: NodeJS.ProcessEnv;
  now?: () => number;
}): Promise<IntakeResult> {
  const environment = input.environment ?? process.env;
  const reply = (
    outcome: Exclude<IntakeResult['outcome'], 'disabled' | 'not_handled'>,
    status = 503
  ): IntakeResult => ({
    outcome,
    response: Response.json(
      status === 200
        ? {
            received: true,
            ...(outcome === 'conflict'
              ? { quarantined: true }
              : { custodyQueued: true, duplicate: outcome === 'duplicate' }),
          }
        : {
            error: 'Primary card signed intake unavailable',
            code: 'PRIMARY_CARD_INBOX_UNAVAILABLE',
          },
      { status, headers: { 'Cache-Control': 'no-store' } }
    ),
  });
  const config = readPrimaryCardCustodyIntakeRuntime(
    environment,
    (input.now ?? Date.now)()
  );
  if (!config) {
    if (environment.PIGGYVEST_PRIMARY_CARD_SIGNED_INBOX_ENABLED !== 'false')
      return reply('not_ready');
    let payload: unknown;
    try {
      if (input.rawBody.byteLength === 0 || input.rawBody.byteLength > 65536)
        return reply('invalid_payload');
      payload = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(input.rawBody)
      );
    } catch {
      return reply('invalid_payload');
    }
    const parsed = schemas.envelope.safeParse(payload);
    if (!parsed.success) return reply('invalid_payload');
    if (
      parsed.data.pvb_third_party_reference?.startsWith(
        'pvb-primary-transfer-'
      ) ||
      (parsed.data.eventType === 'wallet-transfer.outflow.success' &&
        (!environment.PIGGYVEST_PRIMARY_CARD_TREASURY_WEBHOOK_CUSTOMER_ID ||
          parsed.data.customer_id ===
            environment.PIGGYVEST_PRIMARY_CARD_TREASURY_WEBHOOK_CUSTOMER_ID))
    )
      return reply('not_ready');
    return { outcome: 'disabled', response: null };
  }
  const { payloadContract, mappingContract } = config.signedInbox;
  const capability = JSON.stringify({
    ...config.crosswalkAuthority,
    payloadContract,
    mappingContract,
    merchantId: config.merchantId,
    businessId: config.businessId,
    expiresAt: config.expiresAt,
  });
  try {
    const accept = createPrimaryCardCustodyInboxIntake({
      configuration: config,
      capability,
      execute: createPrimaryCardCustodyExecutor(config),
      now: input.now,
    });
    const outcome = await accept(input.rawBody, input.signature);
    if (outcome === 'not_handled') return { outcome, response: null };
    return reply(
      outcome,
      ['accepted', 'duplicate', 'conflict'].includes(outcome) ? 200 : 503
    );
  } catch {
    return reply('storage_unavailable');
  }
}
