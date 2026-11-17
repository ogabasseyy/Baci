import type { User } from '@supabase/supabase-js';
import { render, screen } from '@testing-library/react-native';
import { useAuthStore } from '@/stores/auth-store';
import { SavingsToast } from './SavingsToast';
import { useSavingsToastStore } from './savings-toast-store';

// Local state only: no server call, so it is the same with PiggyVest on or off.
describe('SavingsToast', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: 'user-1' } as User,
      merchantId: 'merchant-1',
    });
  });

  it('shows nothing without a toast', () => {
    useSavingsToastStore.setState({ toast: null });
    render(<SavingsToast />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the acknowledgement for this account only', () => {
    useSavingsToastStore.setState({
      toast: {
        id: 1,
        message: '₦100 added to iPhone 15',
        scope: 'user-1:merchant-1',
      },
    });
    const view = render(<SavingsToast />);
    expect(screen.getByText('₦100 added to iPhone 15')).toBeOnTheScreen();
    useAuthStore.setState({ user: { id: 'user-2' } as User });
    view.rerender(<SavingsToast />);
    expect(screen.queryByText('₦100 added to iPhone 15')).toBeNull();
  });

  it('drops a toast for another account so it never resurfaces on switching back', () => {
    useSavingsToastStore.setState({
      toast: {
        id: 2,
        message: '₦100 added to iPhone 15',
        scope: 'user-1:merchant-1',
      },
    });
    useAuthStore.setState({ user: { id: 'user-2' } as User });
    const view = render(<SavingsToast />);
    expect(useSavingsToastStore.getState().toast).toBeNull();
    useAuthStore.setState({ user: { id: 'user-1' } as User });
    view.rerender(<SavingsToast />);
    expect(screen.queryByText('₦100 added to iPhone 15')).toBeNull();
  });

  it('drops the toast when the wallet is left before it times out', () => {
    useSavingsToastStore.setState({
      toast: {
        id: 3,
        message: '₦100 added to iPhone 15',
        scope: 'user-1:merchant-1',
      },
    });
    const view = render(<SavingsToast />);
    expect(screen.getByText('₦100 added to iPhone 15')).toBeOnTheScreen();
    view.unmount();
    expect(useSavingsToastStore.getState().toast).toBeNull();
  });
});
