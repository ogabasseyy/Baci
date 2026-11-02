import { render } from '@testing-library/react-native';
import { usePiggyvestWalletSetup } from '@/hooks/use-piggyvest-wallet-setup';
import { usePiggyvestPrimaryCapability } from '@/lib/piggyvest-primary-capability';
import { WalletContent } from './WalletContent';
import { WalletPrimaryAccountContent } from './WalletPrimaryAccountContent';
import { createWalletContentProps } from './wallet-content.test-utils';

jest.mock('@/hooks/use-piggyvest-wallet-setup', () => ({
  usePiggyvestWalletSetup: jest.fn(),
}));
jest.mock('@/lib/piggyvest-primary-capability', () => ({
  usePiggyvestPrimaryCapability: jest.fn(),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (value: { user: { id: string } }) => unknown) =>
    selector({ user: { id: 'user-a' } }),
}));
jest.mock('./WalletContent', () => ({ WalletContent: jest.fn(() => null) }));
const props = { ...createWalletContentProps(), merchantId: 'merchant-a' };

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(usePiggyvestWalletSetup)
    .mockReturnValue({ account: null } as ReturnType<
      typeof usePiggyvestWalletSetup
    >);
});

it('keeps recovery scoped to the signed-in customer and suppresses legacy details for primary wallets', () => {
  jest.mocked(usePiggyvestPrimaryCapability).mockReturnValue(true);
  render(<WalletPrimaryAccountContent {...props} />);
  expect(usePiggyvestWalletSetup).toHaveBeenCalledWith('merchant-a', 'user-a');
  expect(jest.mocked(WalletContent).mock.calls[0][0].fundingAccount).toBeNull();
});

it('preserves the existing funding account for stores without primary capability', () => {
  jest.mocked(usePiggyvestPrimaryCapability).mockReturnValue(false);
  render(<WalletPrimaryAccountContent {...props} />);
  expect(usePiggyvestWalletSetup).not.toHaveBeenCalled();
  expect(jest.mocked(WalletContent).mock.calls[0][0].fundingAccount).toEqual(
    props.fundingAccount
  );
});

it('keeps the primary layout pending without initializing setup or exposing legacy bank details', () => {
  jest.mocked(usePiggyvestPrimaryCapability).mockReturnValue(null);
  const { rerender } = render(<WalletPrimaryAccountContent {...props} />);
  expect(usePiggyvestWalletSetup).not.toHaveBeenCalled();
  expect(jest.mocked(WalletContent).mock.calls.at(-1)?.[0]).toMatchObject({
    primaryCapabilityPending: true,
    fundingAccount: null,
  });
  jest.mocked(usePiggyvestPrimaryCapability).mockReturnValue(true);
  rerender(<WalletPrimaryAccountContent {...props} />);
  expect(usePiggyvestWalletSetup).toHaveBeenCalledWith('merchant-a', 'user-a');
  expect(
    jest.mocked(WalletContent).mock.calls.at(-1)?.[0].primaryCapabilityPending
  ).not.toBe(true);
});
