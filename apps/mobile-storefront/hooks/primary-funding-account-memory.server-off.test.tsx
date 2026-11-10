import { describe, expect, it, jest } from '@jest/globals';
import {
  beginPrimaryRead,
  recallPrimaryFundingAccount,
  rememberPrimaryFundingAccount,
} from './primary-funding-account-memory';

/** Remembers an answer as the newest read, as a fresh read would. */
const rememberNow = (
  value: Parameters<typeof rememberPrimaryFundingAccount>[2]
) => rememberPrimaryFundingAccount('m', 'u', value, beginPrimaryRead('m', 'u'));

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'u' } }) },
}));

// With PiggyVest off the server answers not ready: nothing is remembered, so
// every wallet load asks again and the legacy wallet shows as before.
describe('primary funding account memory with the server off', () => {
  it('remembers no not-ready or unavailable answer', () => {
    rememberNow({ status: 'not_ready' });
    expect(recallPrimaryFundingAccount('m', 'u')).toBeNull();
    rememberNow({ status: 'unavailable' });
    expect(recallPrimaryFundingAccount('m', 'u')).toBeNull();
  });
});
