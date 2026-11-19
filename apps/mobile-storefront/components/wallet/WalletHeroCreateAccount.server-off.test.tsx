// Server-off release-gate test: PiggyVest stays off server-side; the
// component must render and behave exactly as in production.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { WalletHeroCreateAccount } from './WalletHeroCreateAccount';

const props = {
  canCreate: true,
  isCreating: false,
  needsPhone: false,
  onCreate: jest.fn(),
  onOpenFundPanel: jest.fn(),
};

beforeEach(() => jest.clearAllMocks());

it('creates a funding account from the future account-number slot', () => {
  render(<WalletHeroCreateAccount {...props} />);
  fireEvent.press(
    screen.getByRole('button', { name: 'Create account number' })
  );
  expect(props.onCreate).toHaveBeenCalledTimes(1);
});

it('opens the phone flow instead of creating when a phone is required', () => {
  render(<WalletHeroCreateAccount {...props} needsPhone canCreate={false} />);
  fireEvent.press(
    screen.getByRole('button', { name: 'Create account number' })
  );
  expect(props.onOpenFundPanel).toHaveBeenCalledTimes(1);
  expect(props.onCreate).not.toHaveBeenCalled();
});

it('disables creation while account availability is unknown', () => {
  render(<WalletHeroCreateAccount {...props} canCreate={false} />);
  expect(
    screen.getByRole('button', { name: 'Create account number' })
  ).toHaveAccessibilityState({ disabled: true });
});

it('bugfix: the label sits on the add icon’s centre line', () => {
  render(<WalletHeroCreateAccount {...props} />);
  // One shared line height centres the 11px label on the 18px icon glyph.
  expect(screen.UNSAFE_getByProps({ name: 'add-circle-outline' })).toHaveStyle({
    lineHeight: 18,
  });
  expect(screen.getByText('Create account number')).toHaveStyle({
    lineHeight: 18,
  });
});
