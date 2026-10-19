type QuizProofEnvironment = {
  NODE_ENV?: string;
  QUIZ_PHASE?: string;
  QUIZ_RPC_SERVER_SECRET?: string;
};

const NON_AGENTIC_WORKER_PROFILES = new Set([
  'ai-storefront-jobs',
  'event-pipeline',
  'petrock-reconciliation',
  'quiz-finalization',
]);

/**
 * Returns whether a production web runtime using the default 1a quiz phase
 * is missing the secret required to sign negotiated-checkout provenance.
 * Build-time CI and bounded workers do not serve negotiated checkout requests.
 */
export function isNegotiatedCheckoutProofSecretMissing(
  value: QuizProofEnvironment,
  runtimeEnv: Readonly<Record<string, string | undefined>> = process.env
) {
  const isGitHubActionsBuild =
    runtimeEnv.GITHUB_ACTIONS === 'true' &&
    Boolean(runtimeEnv.GITHUB_RUN_ID) &&
    Boolean(runtimeEnv.GITHUB_REPOSITORY);
  const isNonAgenticWorker = NON_AGENTIC_WORKER_PROFILES.has(
    runtimeEnv.BACI_WORKER_PROFILE ?? ''
  );

  return (
    value.NODE_ENV === 'production' &&
    value.QUIZ_PHASE === '1a' &&
    !isGitHubActionsBuild &&
    !isNonAgenticWorker &&
    !value.QUIZ_RPC_SERVER_SECRET
  );
}
