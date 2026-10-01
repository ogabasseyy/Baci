import { describe, expect, it } from 'vitest';
import { isNegotiatedCheckoutProofSecretMissing } from './negotiated-checkout-proof-env';

const productionPhaseOneA = {
  NODE_ENV: 'production',
  QUIZ_PHASE: '1a',
};

describe('negotiated checkout proof environment validation', () => {
  it('requires the secret for a production web runtime', () => {
    expect(
      isNegotiatedCheckoutProofSecretMissing(productionPhaseOneA, {})
    ).toBe(true);
  });

  it('accepts a configured secret and non-serving runtimes', () => {
    expect(
      isNegotiatedCheckoutProofSecretMissing(
        { ...productionPhaseOneA, QUIZ_RPC_SERVER_SECRET: 'secret' },
        {}
      )
    ).toBe(false);
    expect(
      isNegotiatedCheckoutProofSecretMissing(productionPhaseOneA, {
        BACI_WORKER_PROFILE: 'event-pipeline',
      })
    ).toBe(false);
    expect(
      isNegotiatedCheckoutProofSecretMissing(productionPhaseOneA, {
        BACI_WORKER_PROFILE: 'quiz-finalization',
      })
    ).toBe(false);
    expect(
      isNegotiatedCheckoutProofSecretMissing(productionPhaseOneA, {
        GITHUB_ACTIONS: 'true',
        GITHUB_REPOSITORY: 'ogabasseyy/Baci',
        GITHUB_RUN_ID: '123',
      })
    ).toBe(false);
  });

  it('does not require the secret outside production phase 1a', () => {
    expect(
      isNegotiatedCheckoutProofSecretMissing(
        { ...productionPhaseOneA, NODE_ENV: 'test' },
        {}
      )
    ).toBe(false);
    expect(
      isNegotiatedCheckoutProofSecretMissing(
        { ...productionPhaseOneA, QUIZ_PHASE: 'production' },
        {}
      )
    ).toBe(false);
  });
});
