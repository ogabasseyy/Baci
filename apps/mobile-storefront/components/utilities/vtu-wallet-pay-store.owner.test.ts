import { useAuthStore } from '@/stores/auth-store';
import { payFromPiggyvest, useVtuWalletPayStore } from './vtu-wallet-pay-store';

jest.mock('@/stores/auth-store', () => {
  const state: { user: { id: string } | null } = { user: { id: 'user-a' } };
  return {
    useAuthStore: Object.assign(() => null, {
      getState: () => state,
      setState: (next: Partial<typeof state>) => Object.assign(state, next),
    }),
  };
});

const request = {
  amount: 500,
  phoneNumber: '08031234567',
  type: 'airtime' as const,
  walletAmount: 500,
};
const auth = useAuthStore as unknown as {
  setState: (next: { user: { id: string } | null }) => void;
};

beforeEach(() => {
  auth.setState({ user: { id: 'user-a' } });
  useVtuWalletPayStore.setState({ covers: () => true, pending: null });
});

describe('bugfix: an account switch during the kept-key lookup handed the form to the new account (Codex P1)', () => {
  it('drops the stale form instead of opening the sheet for the new account', async () => {
    useVtuWalletPayStore.setState({
      retains: async () => {
        auth.setState({ user: { id: 'user-b' } });
        return false;
      },
    });
    await expect(
      payFromPiggyvest(request, jest.fn(), '08031234567', false)
    ).resolves.toBe(true);
    expect(useVtuWalletPayStore.getState().pending).toBeNull();
  });

  it('records the submitting account on the hand-over', async () => {
    useVtuWalletPayStore.setState({ retains: async () => false });
    await payFromPiggyvest(request, jest.fn(), '08031234567', false);
    expect(useVtuWalletPayStore.getState().pending?.userId).toBe('user-a');
    useVtuWalletPayStore.setState({ pending: null });
  });
});
