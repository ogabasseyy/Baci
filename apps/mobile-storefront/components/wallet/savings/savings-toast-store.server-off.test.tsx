import type { User } from '@supabase/supabase-js';
import { useAuthStore } from '@/stores/auth-store';
import { savingsToaster, useSavingsToastStore } from './savings-toast-store';

// Local state only: no server call, so it is the same with PiggyVest on or off.
describe('savingsToaster', () => {
  beforeEach(() => {
    useSavingsToastStore.setState({ toast: null });
    useAuthStore.setState({
      user: { id: 'user-1' } as User,
      merchantId: 'merchant-1',
    });
  });

  it('shows a toast for the account that started the work', () => {
    const toast = savingsToaster();
    expect(toast('₦100 added to iPhone 15')).toBe(true);
    expect(useSavingsToastStore.getState().toast).toMatchObject({
      message: '₦100 added to iPhone 15',
      scope: 'user-1:merchant-1',
    });
    useSavingsToastStore.getState().clear();
    expect(useSavingsToastStore.getState().toast).toBeNull();
  });

  it('drops the toast when another account signed in meanwhile', () => {
    const toast = savingsToaster();
    useAuthStore.setState({ user: { id: 'user-2' } as User });
    expect(toast('₦100 added to iPhone 15')).toBe(false);
    expect(useSavingsToastStore.getState().toast).toBeNull();
  });
});
