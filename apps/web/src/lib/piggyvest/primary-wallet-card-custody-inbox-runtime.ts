import 'server-only';
import { primaryCardCustodyInboxSchemas as schemas } from '@/schemas/primary-wallet-card-custody-inbox';
import { readPrimaryCardCustodyRuntime } from './primary-wallet-card-custody-runtime';

export function readPrimaryCardCustodyInboxRuntime(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now()
) {
  const custody = readPrimaryCardCustodyRuntime(env, now);
  if (!custody || env.PIGGYVEST_PRIMARY_CARD_SIGNED_INBOX_ENABLED !== 'true')
    return null;
  const parsed = schemas.runtime.safeParse({
    ...custody,
    signedInbox: {
      payloadContract: env.PIGGYVEST_PRIMARY_CARD_SIGNED_PAYLOAD_CONTRACT,
      mappingContract: env.PIGGYVEST_PRIMARY_CARD_SIGNED_MAPPING_CONTRACT,
      batchSize: Number(env.PIGGYVEST_PRIMARY_CARD_SIGNED_BATCH_SIZE),
    },
  });
  return parsed.success ? parsed.data : null;
}
