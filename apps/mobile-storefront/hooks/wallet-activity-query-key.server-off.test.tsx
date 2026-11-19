import { WALLET_ACTIVITY_QUERY_KEY } from './wallet-activity-query-key';

describe('WALLET_ACTIVITY_QUERY_KEY with the server keeping PiggyVest off', () => {
  it('is one fixed, non-empty key every activity list and refresh shares', () => {
    expect(WALLET_ACTIVITY_QUERY_KEY).toEqual(['piggyvest-wallet-activity']);
  });
});
