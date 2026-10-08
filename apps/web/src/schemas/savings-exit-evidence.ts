import { z } from 'zod';

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.:-]+$/);
const kobo = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const configuration = z
  .object({
    integrationId: z.uuid(),
    expectedBusinessId: identifier,
    webhookSecret: z.string().trim().min(1).max(4096),
    apiSecret: z.string().trim().min(1).max(4096),
  })
  .strict();
const envelope = z.object({
  eventId: identifier,
  customer_id: identifier,
  eventType: z.literal('wallet-transfer.outflow.success'),
  pvb_reference: identifier,
  pvb_wallet: identifier,
});
const transaction = z.object({
  status: z.literal(true),
  data: z.object({
    id: identifier,
    customer_id: identifier,
    source_wallet: identifier,
    destination_wallet: identifier,
    reference: z.uuid(),
    category: z.literal('wallet_transfer'),
    status: z.literal('successful'),
    amount: kobo.positive(),
    fee: kobo,
  }),
});
const tsq = z.object({
  status: z.literal(true),
  data: z.object({
    reference: z.uuid(),
    status: z.literal('success'),
    amount: kobo.positive(),
  }),
});
const wallet = z.object({
  status: z.literal(true),
  data: z.object({
    id: identifier,
    business_id: identifier,
    currency: z.literal('NGN'),
    status: z.literal('active'),
  }),
});
const receipt = z
  .object({
    eventId: identifier,
    providerTransactionId: identifier,
    providerCustomerId: identifier,
    reference: z.uuid(),
    sourceWalletId: identifier,
    destinationWalletId: identifier,
    businessId: identifier,
    currency: z.literal('NGN'),
    amountKobo: kobo.positive(),
    feeKobo: kobo,
    payloadSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const storedRows = z
  .array(
    z
      .object({
        result: z.object({ state: z.enum(['stored', 'deferred']) }).strict(),
      })
      .strict()
  )
  .length(1);

const localStoreConfiguration = z
  .object({
    integrationId: z.uuid(),
    socketDirectory: z
      .string()
      .regex(
        /^\/(?:private\/)?tmp\/baci-(?:savings-exit-accounting|piggyvest-runtime)\.[A-Za-z0-9]+\/socket$/
      ),
    port: z.number().int().min(1).max(65535),
    // Local-test credential lives in validated configuration (same pattern as
    // piggyvest-postgres-configuration), never inline in the pg client.
    password: z.literal('synthetic-local-only'),
  })
  .strict();

export const savingsExitEvidenceSchemas = {
  configuration,
  envelope,
  transaction,
  tsq,
  wallet,
  receipt,
  storedRows,
  localStoreConfiguration,
};
