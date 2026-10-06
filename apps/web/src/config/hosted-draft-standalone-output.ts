type HostedDraftStandaloneBuildEnvironment = {
  PIGGYVEST_HOSTED_DRAFT_STANDALONE_BUILD?: string;
};

export function getHostedDraftStandaloneOutput(
  environment: HostedDraftStandaloneBuildEnvironment
): { output?: 'standalone' } {
  return environment.PIGGYVEST_HOSTED_DRAFT_STANDALONE_BUILD === 'true'
    ? { output: 'standalone' }
    : {};
}
