import { classifyFetchFailure } from '@/lib/fetch-failure-classification';

export function getSavingsContributionError(error: unknown): string {
  const failure = classifyFetchFailure(error);
  if (
    ['http_server', 'parse', 'network', 'timeout', 'dns'].includes(
      failure.category
    )
  ) {
    return 'We couldn’t confirm your contribution. Check your savings activity before trying again.';
  }
  return error instanceof Error && error.message
    ? error.message
    : 'Unable to record the contribution.';
}
