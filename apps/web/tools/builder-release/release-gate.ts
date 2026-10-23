/** Evidence checklist only: never deploys, provisions credentials or changes submissions. */
export const BUILDER_RELEASE_CHECKS = [
  'localLifecycle',
  'rootLint',
  'rootTypecheck',
  'rootTests',
  'postgres17Replay',
  'privacyCutover',
  'oauthPersistence',
  'stagingDeployment',
  'chatgptHost',
  'publicDelivery',
  'rollback',
  'packageInspection',
  'codexReview',
] as const;
export function assessBuilderRelease(input: {
  sha: string;
  evidenceSha?: string;
  endpoint?: string;
  toolCount?: number;
  checks: Readonly<Record<string, unknown>>;
}) {
  const missing: string[] = BUILDER_RELEASE_CHECKS.filter(
    (name) => input.checks[name] !== true
  );
  if (!/^[a-f0-9]{40}$/.test(input.sha) || input.evidenceSha !== input.sha)
    missing.push('exactEvidenceSha');
  if (input.toolCount !== 8) missing.push('eightToolInventory');
  if (input.endpoint !== 'https://builder-mcp-staging.usebaci.com/builder/mcp')
    missing.push('isolatedStagingEndpoint');
  return {
    go: missing.length === 0,
    missing,
    productionDeploymentAuthorized: false,
    submissionChangesAuthorized: false,
  };
}
