const phases = [
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
] as const;

const profiles = [
  'unknown',
  'worker',
  'authorizer',
  'evidence',
  'customer',
  'reversal',
  'checkout_customer',
  'checkout_authorizer',
] as const;

const codes: readonly string[] = [
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
];

export class PrefundedCardPostgresFailure extends Error {
  readonly diagnostic;

  constructor(
    profile: (typeof profiles)[number],
    phase: (typeof phases)[number],
    error?: unknown
  ) {
    super('Prefunded card database unavailable');
    let code = 'unclassified';
    if (error instanceof Error) {
      const candidate = Object.getOwnPropertyDescriptor(error, 'code')?.value;
      if (typeof candidate === 'string' && codes.includes(candidate))
        code = candidate;
    }
    this.diagnostic = Object.freeze({
      profile: profiles.includes(profile) ? profile : 'unknown',
      phase: phases.includes(phase) ? phase : 'unknown',
      code,
    });
  }
}
