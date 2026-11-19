import { act } from '@testing-library/react-native';
import { useAuthStore } from '@/stores/auth-store';
import { SERVER_OFF_MERCHANT_ID } from '@/test-support/piggyvest-server-off.test-support';

/** Model the signed-in customer required by the wallet screen; restore after each test. */
export function setWalletTestCustomer() {
  const { user, merchantId } = useAuthStore.getState();
  act(() => {
    useAuthStore.setState({
      user: {
        id: 'wallet-test-customer',
        aud: 'authenticated',
        role: 'authenticated',
        app_metadata: {},
        user_metadata: {},
        created_at: '2026-01-01T00:00:00.000Z',
      },
      merchantId: SERVER_OFF_MERCHANT_ID,
    });
  });
  return () => {
    act(() => useAuthStore.setState({ user, merchantId }));
  };
}
