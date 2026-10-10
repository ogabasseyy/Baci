import { z } from 'zod';

const pins = {
  configPath: '/etc/baci-staging/prefunded-first-card.json',
  operationId: 'ff561046-58e7-428d-9163-f6e60b0dab65',
  systemIdentifier: '7685292944002592802',
  login: 'prefunded_treasury_operator',
} as const;

const diagnostic = z.strictObject({
  profile: z.literal('worker'),
  phase: z.enum([
    'configuration',
    'statement-validation',
    'executor-initialization',
    'readiness-result',
    'connect',
    'begin',
    'identity-query',
    'identity-validation',
    'session-query',
    'session-validation',
    'operation',
    'result-validation',
    'commit',
    'commit-validation',
    'deadline',
  ]),
  code: z.enum([
    'unclassified',
    '28P01',
    '28000',
    '42501',
    '42803',
    '42P01',
    '42883',
    '42703',
    '57014',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ECONNRESET',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'CERT_HAS_EXPIRED',
  ]),
});

const common = {
  redacted: z.literal(true),
  financialActionAttempted: z.literal(false),
  newPaymentStarted: z.literal(false),
};

export const prefundedCardReadOperationDiagnosticSchemas = {
  pins,
  arguments: z.tuple([z.literal(pins.configPath)]),
  diagnostic,
  report: z.discriminatedUnion('status', [
    z.strictObject({
      ...common,
      status: z.literal('read-operation-validated'),
      acquiresRowLocks: z.literal(true),
    }),
    z.strictObject({
      ...common,
      status: z.literal('read-operation-refused'),
      stage: z.enum(['arguments', 'configuration', 'executor', 'read-result']),
      diagnostic: diagnostic.optional(),
    }),
  ]),
};
