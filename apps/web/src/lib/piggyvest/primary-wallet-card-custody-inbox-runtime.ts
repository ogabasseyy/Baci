import 'server-only';
import { primaryCardCustodyInboxSchemas as schemas } from '@/schemas/primary-wallet-card-custody-inbox';
import { readPrimaryCardCustodyRuntime } from './primary-wallet-card-custody-runtime';
import {
  type WebhookKeyScope,
  withFamilyArchivedSecrets,
} from './webhook-key-archive';

export function readPrimaryCardCustodyInboxRuntime(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
  mode: 'intake' | 'drain' = 'intake',
  keyScope: WebhookKeyScope = 'ingress'
) {
  const custody = readPrimaryCardCustodyRuntime(env, now, mode);
  if (
    !custody ||
    (mode === 'intake' &&
      env.PIGGYVEST_PRIMARY_CARD_SIGNED_INBOX_ENABLED !== 'true')
  )
    return null;
  const parsed = schemas.runtime.safeParse({
    ...custody,
    signedInbox: {
      payloadContract: env.PIGGYVEST_PRIMARY_CARD_SIGNED_PAYLOAD_CONTRACT,
      mappingContract: env.PIGGYVEST_PRIMARY_CARD_SIGNED_MAPPING_CONTRACT,
      batchSize: Number(env.PIGGYVEST_PRIMARY_CARD_SIGNED_BATCH_SIZE),
    },
  });
  return parsed.success
    ? withFamilyArchivedSecrets(
        parsed.data,
        'custody',
        env,
        now,
        mode === 'drain' ? 'replay' : keyScope
      )
    : null;
}
