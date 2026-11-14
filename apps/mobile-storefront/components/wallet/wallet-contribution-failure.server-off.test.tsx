import { shouldReportContributionFailure } from './wallet-contribution-failure';

// With the server keeping PiggyVest off, legacy failures are reported and
// their ids kept exactly as in production today; a not-ready answer never
// releases an id.
describe('server keeps PiggyVest off', () => {
  it('reports a not-ready refusal without releasing the stored id', () => {
    const release = jest.fn();
    const notReady = Object.assign(new Error('not ready'), {
      code: 'PIGGYVEST_NOT_READY',
    });
    expect(shouldReportContributionFailure(notReady, release)).toBe(true);
    expect(release).not.toHaveBeenCalled();
  });
});
