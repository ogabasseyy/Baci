import { getSavingsContributionError } from './get-savings-contribution-error';

describe('getSavingsContributionError', () => {
  it('does not expose the HTML gateway parser failure to customers', () => {
    const error = new Error(
      'Invalid server response (502 bad gateway): JSON Parse error: Unexpected character: <'
    );

    expect(getSavingsContributionError(error)).toBe(
      'We couldn’t confirm your contribution. Check your savings activity before trying again.'
    );
  });

  it('preserves an actionable business error', () => {
    expect(
      getSavingsContributionError(new Error('Add money to your wallet first.'))
    ).toBe('Add money to your wallet first.');
  });

  it('provides a fallback when an unknown value is thrown', () => {
    expect(getSavingsContributionError(null)).toBe(
      'Unable to record the contribution.'
    );
  });
});
