import { z } from 'zod';

const identifier = z.uuid().transform((value) => value.toLowerCase());
const reference = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/);
const providerIdentifier = z.string().min(1).max(512).regex(/^\S+$/);

export const prefundedCardClaimedRequestSchema = z
  .strictObject({
    operationId: identifier,
    integrationId: identifier,
    merchantId: identifier,
    customerId: identifier,
    goalId: identifier,
    treasuryBindingId: identifier,
    businessId: providerIdentifier,
    sourceWalletId: providerIdentifier,
    collectionReference: reference,
    transferReference: reference,
    amountKobo: z.number().int().positive().safe(),
    currency: z.literal('NGN'),
    savedMethodId: identifier,
    destinationWalletId: providerIdentifier,
    destinationCustomerId: providerIdentifier,
  })
  .refine(
    (request) =>
      request.sourceWalletId !== request.destinationWalletId &&
      request.collectionReference !== request.transferReference
  );
