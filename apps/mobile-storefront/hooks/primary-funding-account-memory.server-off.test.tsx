import { describe, expect, it, jest } from '@jest/globals';
import {
  recallPrimaryFundingAccount,
  rememberPrimaryFundingAccount,
} from './primary-funding-account-memory';

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'u' } }) },
}));

// With PiggyVest off the server answers not ready: nothing is remembered, so
// every wallet load asks again and the legacy wallet shows as before.
describe('primary funding account memory with the server off', () => {
  it('remembers no not-ready or unavailable answer', () => {
    rememberPrimaryFundingAccount('m', 'u', { status: 'not_ready' });
    expect(recallPrimaryFundingAccount('m', 'u')).toBeNull();
    rememberPrimaryFundingAccount('m', 'u', { status: 'unavailable' });
    expect(recallPrimaryFundingAccount('m', 'u')).toBeNull();
  });
});
