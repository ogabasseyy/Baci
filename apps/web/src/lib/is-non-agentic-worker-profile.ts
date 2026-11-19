const NON_AGENTIC_WORKER_PROFILES = new Set([
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
]);

export function isNonAgenticWorkerProfile(value: string | undefined) {
  return NON_AGENTIC_WORKER_PROFILES.has(value ?? '');
}
