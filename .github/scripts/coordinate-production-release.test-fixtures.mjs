// Shared operations fixture for the coordinator suites. Split from
// coordinate-production-release.test.mjs so both suites stay under
// the 300-line limit.
export const commit = 'b'.repeat(40);
export const coordinationId = 'test-coordination';

export function fixture(overrides = {}) {
  const calls = [];
  const operations = {
    verifyCheckout: async () => commit,
    readMain: async () => commit,
    updateWorkers: async () => {},
    verifyWorkers: async () => {},
    listRuns: async () => [],
    dispatch: async () => {},
    findRun: async () => ({ databaseId: 42, headSha: commit }),
    listCoordinatedRuns: async () => [],
    watchRun: async () => {},
    cancelRun: async () => {},
    readJobs: async () => [{ name: 'deploy-production', conclusion: 'success' }],
    readAttemptCount: async () => 1,
    verifyLive: async () => {},
    ...overrides,
  };
  return {
    calls,
    operations: Object.fromEntries(Object.entries(operations).map(([name, operation]) => [
      name,
      async (...args) => {
        calls.push(name);
        return operation(...args);
      },
    ])),
  };
}
