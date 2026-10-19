import z from 'zod';

const transferIdentitySchema = z.object({
  authorizationId: z.uuid(),
  reference: z.string().min(1).max(200),
  customerId: z.uuid(),
  merchantId: z.uuid(),
  walletId: z.string().min(1).max(200),
  amountKobo: z.int().positive(),
  currency: z.literal('NGN'),
  sourceWalletId: z.string().min(1).max(200),
  destinationRef: z.string().min(1).max(200),
  direction: z.enum(['bank', 'wallet']),
  providerCustomerId: z.string().min(1).max(200),
  businessId: z.string().min(1).max(200),
  integrationId: z.string().min(1).max(200),
});

export const transferOutboxSubmissionSchemas = {
  command: transferIdentitySchema.superRefine((value, context) => {
    if (
      value.direction === 'bank' &&
      !/^\d{3,10}:[\d*]{4}$/.test(value.destinationRef)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Bank transfer destinations must contain only bank code and last four',
        path: ['destinationRef'],
      });
    }
  }),
  storeConfig: z.object({
    expectedSystemId: z.string().regex(/^\d{1,20}$/),
    businessId: z.string().min(1).max(200),
    integrationId: z.string().min(1).max(200),
  }),
  claimOutcome: z.enum([
    'claimed',
    'already-claimed',
    'already-submitted',
    'outcome-unknown',
    'identity-conflict',
  ]),
  recordAcceptedOutcome: z.enum([
    'submitted',
    'already-submitted',
    'outcome-unknown',
    'identity-conflict',
  ]),
  markUnknownOutcome: z.enum([
    'outcome-unknown',
    'already-submitted',
    'identity-conflict',
  ]),
  recoveryOutcome: z.enum([
    'applied',
    'duplicate',
    'terminal-conflict',
    'identity-conflict',
    'not-recoverable',
  ]),
  outcomeRow: z.object({ outcome: z.unknown() }).strict(),
};

export type TrustedTransferSubmission = z.infer<
  typeof transferOutboxSubmissionSchemas.command
>;
