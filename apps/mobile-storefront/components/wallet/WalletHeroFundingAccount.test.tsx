import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { setClipboardString } from '@/lib/clipboard';
import { WalletHeroFundingAccount } from './WalletHeroFundingAccount';

jest.mock('@/lib/clipboard', () => ({ setClipboardString: jest.fn() }));
beforeEach(() => jest.clearAllMocks());

it('copies the server-provided account number without changing its digits', async () => {
  jest.mocked(setClipboardString).mockResolvedValue(true);
  render(
    <WalletHeroFundingAccount
      account={{
        accountName: 'OGABASSEY TEST',
        accountNumber: '1234567890',
        bankName: 'Test Bank',
        provider: 'paystack',
      }}
    />
  );

  fireEvent.press(
    screen.getByRole('button', { name: 'Copy funding account number' })
  );

  await waitFor(() =>
    expect(setClipboardString).toHaveBeenCalledWith('1234567890')
  );
  expect(
    screen.getByText('Account number copied to clipboard.')
  ).toBeOnTheScreen();
});

it('disables copying a synthetic preview account', () => {
  render(
    <WalletHeroFundingAccount
      account={{
        accountName: 'Preview only',
        accountNumber: '0000000000',
        bankName: 'Demo bank',
        provider: 'preview',
      }}
      preview
    />
  );

  expect(
    screen.getByRole('button', {
      name: 'Preview account number, not for transfers',
    })
  ).toHaveAccessibilityState({ disabled: true });
  expect(
    screen.queryByRole('button', { name: 'Copy funding account number' })
  ).toBeNull();
  expect(setClipboardString).not.toHaveBeenCalled();
});

it('shows only the number and bank while keeping sandbox purpose available to screen readers', () => {
  render(
    <WalletHeroFundingAccount
      account={{
        accountName: 'OGABASSEY TEST',
        accountNumber: '1234567890',
        bankName: 'FAAS (SANDBOX)',
        provider: 'piggyvest',
      }}
      purpose="savings"
      sandbox
    />
  );

  expect(
    screen.getByRole('button', { name: 'Copy savings account number' })
  ).toHaveProp(
    'accessibilityHint',
    'Test savings account. Do not send real money.'
  );
  expect(screen.getByText('1234567890')).toBeOnTheScreen();
  expect(screen.getByText('FAAS (SANDBOX)')).toBeOnTheScreen();
  expect(screen.queryByText('SAVINGS · TEST')).toBeNull();
  expect(screen.queryByText('Savings only · No real money')).toBeNull();
  expect(screen.queryByText('Powered by PiggyVest')).toBeNull();
  expect(screen.queryByText('OGABASSEY TEST')).toBeNull();
});

it('keeps live savings details compact without losing the accessible transfer purpose', () => {
  render(
    <WalletHeroFundingAccount
      account={{
        accountName: 'OGABASSEY',
        accountNumber: '1234567890',
        bankName: 'Savings Bank',
        provider: 'piggyvest',
      }}
      purpose="savings"
    />
  );

  expect(screen.getByText('1234567890')).toBeOnTheScreen();
  expect(screen.getByText('Savings Bank')).toBeOnTheScreen();
  expect(screen.queryByText('SAVINGS ACCOUNT')).toBeNull();
  expect(screen.queryByText('Savings only')).toBeNull();
  expect(screen.queryByText('OGABASSEY')).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Copy savings account number' })
  ).toHaveProp('accessibilityHint', 'Transfers fund the savings plan');
});
