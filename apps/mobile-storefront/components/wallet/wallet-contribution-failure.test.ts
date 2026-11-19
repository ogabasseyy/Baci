import { PIN_CANCELLED_CODE } from '@/lib/wallet-pin-proof';
import { shouldReportContributionFailure } from './wallet-contribution-failure';

const coded = (code: string) => Object.assign(new Error(code), { code });

describe('shouldReportContributionFailure', () => {
  it('stays silent and keeps the id when the PIN sheet was closed', () => {
    const release = jest.fn();
    expect(
      shouldReportContributionFailure(coded(PIN_CANCELLED_CODE), release)
    ).toBe(false);
    expect(release).not.toHaveBeenCalled();
  });

  it('releases the id and reports when the server cancelled the reservation', () => {
    const release = jest.fn();
    expect(
      shouldReportContributionFailure(coded('WALLET_UNAVAILABLE'), release)
    ).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it.each([
    new Error('timed out'),
    coded('SAVINGS_MERCHANT_NOT_PRIMARY'),
    'x',
    null,
  ])('keeps the id and reports any other failure (%s)', (error) => {
    const release = jest.fn();
    expect(shouldReportContributionFailure(error, release)).toBe(true);
    expect(release).not.toHaveBeenCalled();
  });

  it('tolerates a missing release callback', () => {
    expect(shouldReportContributionFailure(coded('WALLET_UNAVAILABLE'))).toBe(
      true
    );
  });
});
