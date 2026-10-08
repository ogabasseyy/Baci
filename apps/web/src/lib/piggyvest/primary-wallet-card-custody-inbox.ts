import 'server-only';
import { primaryWalletCardCustodySchemas as custodySchemas } from '@/schemas/primary-wallet-card-custody';
import { primaryCardCustodyInboxSchemas as schemas } from '@/schemas/primary-wallet-card-custody-inbox';
import { createPrimaryCardCustodyExecutor } from './primary-wallet-card-custody-executor';
import { createPrimaryCardCustodyInboxIntake } from './primary-wallet-card-custody-inbox-intake';
import { createPrimaryCardCustodyInboxMapping } from './primary-wallet-card-custody-inbox-mapping';
import { createPrimaryCardCustodyInboxWorker } from './primary-wallet-card-custody-inbox-worker';
import { createPrimaryCardCustodyReader } from './primary-wallet-card-custody-reader';

export function createPrimaryCardCustodyInbox(input: {
  configuration: unknown;
  fetchImplementation: typeof fetch;
  resolveAuthenticatedCrosswalk: Parameters<
    typeof createPrimaryCardCustodyReader
  >[0]['resolveAuthenticatedCrosswalk'];
  now?: () => number;
}) {
  const config = schemas.runtime.parse(input.configuration);
  const { signedInbox, ...selected } = config;
  const custody = custodySchemas.runtime.parse(selected);
  const execute = createPrimaryCardCustodyExecutor(custody);
  const { batchSize: _batch, ...contracts } = signedInbox;
  const capability = JSON.stringify({
    ...config.crosswalkAuthority,
    ...contracts,
    merchantId: config.merchantId,
    businessId: config.businessId,
    expiresAt: config.expiresAt,
  });
  const common = { configuration: config, capability, execute, now: input.now };
  return {
    async readiness() {
      const now = (input.now ?? Date.now)();
      if (!Number.isFinite(now) || now >= Date.parse(config.expiresAt))
        return { ready: false as const };
      return schemas.readiness.parse(
        await execute('inboxReadiness', [capability])
      );
    },
    acceptSigned: createPrimaryCardCustodyInboxIntake(common),
    drain: createPrimaryCardCustodyInboxWorker({
      ...common,
      resolveOperation: createPrimaryCardCustodyInboxMapping({
        ...common,
        fetchImplementation: input.fetchImplementation,
      }),
      observe: createPrimaryCardCustodyReader({
        ...input,
        configuration: custody,
      }),
    }),
  };
}
