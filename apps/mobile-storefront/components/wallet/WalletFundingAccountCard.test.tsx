import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { setClipboardString } from '@/lib/clipboard';
import { WalletFundingAccountCard } from './WalletFundingAccountCard';

jest.mock('@/lib/clipboard', () => ({ setClipboardString: jest.fn() }));

const baseProps = {
  accentColor: Colors.dark.primary,
  canCreateFundingAccount: true,
  colors: Colors.dark,
  fundingAccount: {
    accountName: 'OGABASSEY TEST CUSTOMER',
    accountNumber: '1234567890',
    bankName: 'Test Bank',
    provider: 'piggyvest',
  },
  isCreatingFundingAccount: false,
  needsPhone: false,
  onCreateFundingAccount: jest.fn(),
  onOpenFundPanel: jest.fn(),
};

describe('WalletFundingAccountCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(setClipboardString).mockResolvedValue(true);
  });

  it('shows only the supplied bank account and copies its raw number', async () => {
    render(<WalletFundingAccountCard {...baseProps} />);

    expect(screen.getByText('Test Bank')).toBeOnTheScreen();
    expect(screen.getByText('1234567890')).toBeOnTheScreen();
    expect(screen.getByText('OGABASSEY TEST CUSTOMER')).toBeOnTheScreen();
    expect(screen.getByText('Powered by PiggyVest')).toBeOnTheScreen();
    fireEvent.press(
      screen.getByRole('button', { name: 'Copy funding account number' })
    );
    await waitFor(() =>
      expect(setClipboardString).toHaveBeenCalledWith('1234567890')
    );
  });

  it('keeps account creation disabled and explains an unavailable state', () => {
    const onCreateFundingAccount = jest.fn();
    render(
      <WalletFundingAccountCard
        {...baseProps}
        canCreateFundingAccount={false}
        createFundingAccountUnavailableMessage="Account creation is unavailable."
        fundingAccount={null}
        onCreateFundingAccount={onCreateFundingAccount}
      />
    );

    const button = screen.getByRole('button', {
      name: 'Create account number',
    });
    expect(button.props.accessibilityState).toMatchObject({ disabled: true });
    expect(
      screen.getByText('Account creation is unavailable.')
    ).toBeOnTheScreen();
    fireEvent.press(button);
    expect(onCreateFundingAccount).not.toHaveBeenCalled();
    expect(screen.queryByText('1234567890')).toBeNull();
  });

  it('opens the fund panel when the customer must first supply a phone', () => {
    const onOpenFundPanel = jest.fn();
    render(
      <WalletFundingAccountCard
        {...baseProps}
        canCreateFundingAccount={false}
        fundingAccount={null}
        needsPhone
        onOpenFundPanel={onOpenFundPanel}
      />
    );

    fireEvent.press(
      screen.getByRole('button', { name: 'Create account number' })
    );
    expect(onOpenFundPanel).toHaveBeenCalledTimes(1);
  });

  it('uses the light surface when the app is in light mode', () => {
    const { toJSON } = render(
      <WalletFundingAccountCard {...baseProps} colors={Colors.light} />
    );
    const rendered = JSON.stringify(toJSON());
    expect(rendered).toContain(Colors.light.card);
    expect(rendered).toContain(Colors.light.cardForeground);
  });
});
