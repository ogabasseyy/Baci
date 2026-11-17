const NON_AGENTIC_WORKER_PROFILES = new Set([
  'ai-storefront-jobs',
  'cart-events',
  'event-pipeline',
  'gigl-tracking',
  'merchant-onboarding-emails',
  'petrock-reconciliation',
  'piggyvest-webhook-capture-drain',
  'process-import-jobs',
  'quiz-finalization',
  'sync-jumia-orders',
]);

export function isNonAgenticWorkerProfile(value: string | undefined) {
  return NON_AGENTIC_WORKER_PROFILES.has(value ?? '');
}
