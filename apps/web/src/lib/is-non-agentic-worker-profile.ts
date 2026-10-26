const NON_AGENTIC_WORKER_PROFILES = new Set([
  'ai-storefront-jobs',
  'event-pipeline',
  'gigl-tracking',
  'merchant-onboarding-emails',
  'petrock-reconciliation',
  'quiz-finalization',
]);

export function isNonAgenticWorkerProfile(value: string | undefined) {
  return NON_AGENTIC_WORKER_PROFILES.has(value ?? '');
}
