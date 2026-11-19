import { describe, expect, it } from 'vitest';
import { isNonAgenticWorkerProfile } from './is-non-agentic-worker-profile';

describe('isNonAgenticWorkerProfile', () => {
  it.each([
    'agentic-commerce-health',
    'ai-storefront-jobs',
    'cart-events',
    'cart-notice-health',
    'cleanup-checkout-shipping-recovery-previews',
    'event-pipeline',
    'gigl-tracking',
    'import-jobs',
    'jumia-order-sync',
    'merchant-onboarding-emails',
    'merchant-signup-health',
    'order-cancellation-side-effects',
    'order-notifications',
    'oxygen-callback-reconciliation',
    'petrock-reconciliation',
    'piggyvest-webhook-capture-drain',
    'purge-jumia-self-authorization-discoveries',
    'quiz-finalization',
    'scheduled-post-publisher',
    'vtu-processing-reconciliation',
  ])('allows the bounded %s worker without agentic signing material', (profile) => {
    expect(isNonAgenticWorkerProfile(profile)).toBe(true);
  });

  it('does not exempt unknown production processes', () => {
    expect(isNonAgenticWorkerProfile('unknown-worker')).toBe(false);
    expect(isNonAgenticWorkerProfile(undefined)).toBe(false);
  });
});
