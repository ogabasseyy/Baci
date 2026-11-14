import { createBoundPublicFetcher } from './public-fetch';
import { checkPublicOutput, describePublicOutput } from './public-output-check';

/** Public read-only network acquisition; output remains untrusted until checked. */
export function fetchPublicOutput(
  binding: unknown,
  executionOrigin: string,
  options: Pick<
    Parameters<typeof createBoundPublicFetcher>[0],
    'resolve' | 'network'
  > = {}
) {
  const urls = describePublicOutput(binding, executionOrigin).map(
    (file) => file.url
  );
  const fetch = createBoundPublicFetcher({
    origins: [executionOrigin],
    urls,
    ...options,
  });
  return checkPublicOutput(binding, executionOrigin, fetch);
}
