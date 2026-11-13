import { act } from '@testing-library/react-native';
import { useAuthStore } from '@/stores/auth-store';
import { currentSavingsNoticeScope } from './current-savings-notice-scope';

// Local auth state only: nothing here needs PiggyVest.
describe('server keeps PiggyVest off: savings notice scope', () => {
  it('scopes notices by the signed-in customer and store', () => {
    act(() => {
      useAuthStore.setState({
        user: { id: 'u-1' } as never,
        merchantId: 'm-1',
      });
    });
    expect(currentSavingsNoticeScope()).toBe('u-1:m-1');
  });
});
