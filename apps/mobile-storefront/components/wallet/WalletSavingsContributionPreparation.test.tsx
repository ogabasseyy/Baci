import { act, fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import {
  fetchExistingSavingsPlanFunding,
  fetchSavingsPlanFunding,
} from '@/lib/customer-savings';
import type { SavingsPlanFundingResponse } from '@/schemas/customer-savings';
import { WalletSavingsContributionSection } from './WalletSavingsContributionSection';

jest.mock('@/lib/customer-savings', () => ({
  fetchExistingSavingsPlanFunding: jest.fn(),
  fetchSavingsPlanFunding: jest.fn(),
}));
jest.mock('./WalletSavingsPlanFunding', () => ({
  WalletSavingsPlanFunding: () => null,
}));
jest.mock('@/lib/config', () => ({
  CONFIG: { MERCHANT_ID: 'merchant-1', MERCHANT_SLUG: 'synthetic' },
}));
jest.mock('@/lib/is-piggyvest-primary-merchant', () => ({
  isPiggyvestPrimaryMerchant: () => true,
}));
let mockCapability: boolean | null = true;
jest.mock('@/lib/piggyvest-primary-capability', () => ({
  usePiggyvestPrimaryCapability: () => mockCapability,
}));
jest.mock('@/lib/is-hosted-staging-wallet-top-up-blocked', () => ({
  isHostedStagingTestPaymentsEnabled: () => true,
  isHostedStagingWalletTopUpBlocked: () => true,
}));
let mockUserId: string | undefined = 'user-1';
let mockMerchantId = 'merchant-1';
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: Object.assign(
    (selector: (state: unknown) => unknown) =>
      selector({
        user: mockUserId ? { id: mockUserId } : null,
        merchantId: mockMerchantId,
      }),
    {
      getState: () => ({
        user: mockUserId ? { id: mockUserId } : null,
        merchantId: mockMerchantId,
      }),
    }
  ),
}));
const ready: SavingsPlanFundingResponse = {
  status: 'ready',
  accounts: [
    {
      accountNumber: '0000008907',
      accountName: 'Synthetic',
      bankName: 'Test bank',
    },
  ],
};
const missing = Object.assign(
  new Error('Savings wallet setup has not started.'),
  {
    code: 'SAVINGS_WALLET_NOT_FOUND',
  }
);
const props = {
  goal: {
    id: 'goal-1',
    title: 'Phone',
    status: 'active' as const,
    source_mode: 'manual' as const,
    current_amount: 0,
    target_amount: 1000,
    contribution_amount: 100,
    contribution_frequency: 'weekly' as const,
    maturity_date: '2026-12-01',
  },
  addAmount: '100',
  colors: Colors.dark,
  isAdding: false,
  isFundPending: false,
  onAddAmountChange: jest.fn(),
  onAddSavings: jest.fn(),
  onFundWallet: jest.fn(),
  remainingAmount: 1000,
  walletBalance: 100,
  hasPendingContribution: false,
  canAdd: true,
  usesPlanFunding: false,
  usesWalletBankTransfer: true,
  visible: true,
};
const recover = jest.mocked(fetchExistingSavingsPlanFunding);
const provision = jest.mocked(fetchSavingsPlanFunding);
const confirm = () =>
  screen.queryByRole('button', { name: 'Confirm savings top-up' });
const prepare = () => screen.getByRole('button', { name: 'Show plan account' });
const check = () =>
  screen.getByRole('button', { name: 'Check account status' });
beforeEach(() => {
  jest.resetAllMocks();
  mockUserId = 'user-1';
  mockMerchantId = 'merchant-1';
  mockCapability = true;
  recover.mockRejectedValue(missing);
  provision.mockResolvedValue(ready);
});

it('does not expose Submit for a funded primary goal until its missing destination is prepared', async () => {
  render(<WalletSavingsContributionSection {...props} />);
  expect(confirm()).toBeNull();
  await act(async () => {});
  expect(prepare()).toBeEnabled();
  expect(screen.queryByLabelText('BVN for plan account')).toBeNull();
  expect(recover).toHaveBeenCalledWith({
    goalId: 'goal-1',
    merchantId: 'merchant-1',
    merchantSlug: 'synthetic',
  });
  expect(provision).not.toHaveBeenCalled();
  expect(props.onAddSavings).not.toHaveBeenCalled();
});

it('uses an already verified destination without provisioning or contributing on open', async () => {
  recover.mockResolvedValue(ready);
  render(<WalletSavingsContributionSection {...props} />);
  expect(confirm()).toBeNull();
  await act(async () => {});
  expect(confirm()).toBeEnabled();
  expect(provision).not.toHaveBeenCalled();
  expect(props.onAddSavings).not.toHaveBeenCalled();
});

it.each([
  false,
  true,
])('prepares once with explicit interest choice %s then permits a separate contribution', async (interest) => {
  render(<WalletSavingsContributionSection {...props} />);
  await act(async () => {});
  const choice = screen.getByRole('checkbox', {
    name: 'Earn interest on this plan',
  });
  expect(choice).not.toBeChecked();
  if (interest) fireEvent.press(choice);
  const button = prepare();
  act(() => {
    fireEvent.press(button);
    fireEvent.press(button);
  });
  expect(confirm()).toBeNull();
  await act(async () => {});
  expect(provision).toHaveBeenCalledTimes(1);
  expect(provision).toHaveBeenCalledWith({
    bvn: '',
    goalId: 'goal-1',
    merchantId: 'merchant-1',
    merchantSlug: 'synthetic',
    enableInterestAccrual: interest,
  });
  expect(props.onAddSavings).not.toHaveBeenCalled();
  fireEvent.press(
    screen.getByRole('button', { name: 'Confirm savings top-up' })
  );
  expect(props.onAddSavings).toHaveBeenCalledTimes(1);
});

it.each([
  { status: 'pending' as const },
  { status: 'unavailable' as const },
  { status: 'ready' as const, accounts: [] },
])('fails closed with status-only recovery for unconfirmed setup %j', async (response) => {
  recover.mockResolvedValue(response);
  render(<WalletSavingsContributionSection {...props} />);
  await act(async () => {});
  expect(confirm()).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Show plan account' })
  ).toBeNull();
  expect(check()).toBeEnabled();
  recover.mockResolvedValue(ready);
  fireEvent.press(check());
  await act(async () => {});
  expect(confirm()).toBeEnabled();
  expect(provision).not.toHaveBeenCalled();
});

it.each([
  'GOAL_NOT_FOUND',
  'SAVINGS_WALLET_CONFLICT',
  'SAVINGS_PROVISIONING_UNAVAILABLE',
])('does not treat %s as permission to provision', async (code) => {
  recover.mockRejectedValue(
    Object.assign(new Error('Unable to confirm'), { code })
  );
  render(<WalletSavingsContributionSection {...props} />);
  await act(async () => {});
  expect(confirm()).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Show plan account' })
  ).toBeNull();
  expect(check()).toBeEnabled();
  expect(provision).not.toHaveBeenCalled();
});

it('checks status after a lost preparation response instead of creating again', async () => {
  provision.mockRejectedValue(new Error('Network unavailable'));
  render(<WalletSavingsContributionSection {...props} />);
  await act(async () => {});
  fireEvent.press(prepare());
  await act(async () => {});
  expect(confirm()).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Show plan account' })
  ).toBeNull();
  recover.mockResolvedValueOnce({ status: 'pending' });
  fireEvent.press(check());
  await act(async () => {});
  expect(check()).toBeEnabled();
  expect(provision).toHaveBeenCalledTimes(1);
});

it.each([
  0, 50,
])('keeps Add money independent of preparation when balance is %s', async (balance) => {
  render(
    <WalletSavingsContributionSection {...props} walletBalance={balance} />
  );
  fireEvent.press(
    screen.getByRole('button', { name: 'Open wallet bank transfer details' })
  );
  await act(async () => {});
  expect(props.onFundWallet).toHaveBeenCalledTimes(1);
  expect(recover).not.toHaveBeenCalled();
  expect(provision).not.toHaveBeenCalled();
});

it('prioritizes pending contribution recovery without preparing another destination', async () => {
  render(
    <WalletSavingsContributionSection {...props} hasPendingContribution />
  );
  fireEvent.press(
    screen.getByRole('button', { name: 'Check contribution status' })
  );
  await act(async () => {});
  expect(props.onAddSavings).toHaveBeenCalledTimes(1);
  expect(recover).not.toHaveBeenCalled();
  expect(provision).not.toHaveBeenCalled();
});

it.each([
  'user',
  'merchant',
  'goal',
  'signout',
] as const)('discards late preparation on %s switch', async (scope) => {
  let finish: (response: SavingsPlanFundingResponse) => void = () => undefined;
  provision.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const view = render(<WalletSavingsContributionSection {...props} />);
  await act(async () => {});
  fireEvent.press(prepare());
  if (scope === 'user') mockUserId = 'user-2';
  if (scope === 'merchant') mockMerchantId = 'merchant-2';
  if (scope === 'signout') mockUserId = undefined;
  view.rerender(
    <WalletSavingsContributionSection
      {...props}
      goal={scope === 'goal' ? { ...props.goal, id: 'goal-2' } : props.goal}
    />
  );
  await act(async () => {
    finish(ready);
  });
  expect(confirm()).toBeNull();
  expect(props.onAddSavings).not.toHaveBeenCalled();
  expect(provision).toHaveBeenCalledTimes(1);
});

it.each([
  null,
  false,
])('never recollects BVN or provisions while primary capability is %s', async (capability) => {
  mockCapability = capability;
  render(<WalletSavingsContributionSection {...props} />);
  await act(async () => {});
  expect(confirm()).toBeNull();
  expect(screen.queryByLabelText('BVN for plan account')).toBeNull();
  expect(check()).toBeEnabled();
  expect(provision).not.toHaveBeenCalled();
});
