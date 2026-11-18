const NON_AGENTIC_WORKER_PROFILES = new Set([
  'agentic-commerce-health',
  'ai-storefront-jobs',
  'cart-notice-health',
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
  'quiz-finalization',
  'scheduled-post-publisher',
  'vtu-processing-reconciliation',
]);

export function isNonAgenticWorkerProfile(value: string | undefined) {
  return NON_AGENTIC_WORKER_PROFILES.has(value ?? '');
}
