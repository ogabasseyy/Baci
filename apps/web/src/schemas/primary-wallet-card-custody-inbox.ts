import { z } from 'zod';
import { prefundedCardProviderEvidenceSchemas as provider } from './prefunded-card-provider-evidence';
import { primaryWalletCardCustodySchemas as custody } from './primary-wallet-card-custody';

const contracts = z.strictObject({
  payloadContract: z.literal('wallet-transfer-outflow-v1'),
  mappingContract: z.literal('single-transaction-third-party-reference-v1'),
  batchSize: z.number().int().min(1).max(10),
});
export const primaryCardCustodyInboxSchemas = {
  runtime: custody.runtime.extend({ signedInbox: contracts }),
  intakeRuntime: custody.runtime
    .omit({ apiToken: true, transfer: true })
    .extend({
      intakeOnly: z.literal(true),
      custody: custody.runtime.shape.custody.extend({
        login: z.literal('baci_primary_card_intake'),
      }),
      signedInbox: contracts.omit({ batchSize: true }),
    }),
  contracts,
  envelope: provider.envelope.safeExtend({
    eventId: z.string().min(1).max(200),
  }),
  readiness: z.discriminatedUnion('ready', [
    z.strictObject({ ready: z.literal(false) }),
    z.strictObject({
      ready: z.literal(true),
      sourceWalletId: custody.context.shape.sourceWalletId,
    }),
  ]),
  enqueue: z.enum(['accepted', 'duplicate', 'conflict']),
  claims: z
    .array(
      z.strictObject({
        eventId: z.string().min(1).max(200),
        token: z.uuid(),
        rawHex: z
          .string()
          .min(2)
          .max(131072)
          .regex(/^(?:[a-f0-9]{2})+$/),
        signature: z.string().regex(/^[a-f0-9]{128}$/),
        attempts: z.number().int().min(1).max(50),
      })
    )
    .max(10),
  operation: z.uuid().nullable(),
  acknowledgement: z.literal(true),
};
