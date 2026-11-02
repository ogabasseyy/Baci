import { fireEvent, render, screen } from '@testing-library/react-native';
import { BRAND, default as Colors, SPACING } from '@/constants/Colors';
import { PiggyvestWalletSetupForm } from './PiggyvestWalletSetupForm';
import { walletSavingsProgressModalStyles as styles } from './wallet-savings-progress-modal.styles';

it('keeps savings popup content and close action away from the edges', () => {
  expect(styles.scrollContent).toMatchObject({ paddingHorizontal: SPACING.lg });
  expect(styles.header).toMatchObject({ paddingHorizontal: SPACING.lg });
  expect(styles.primaryButton.backgroundColor).toBe(BRAND.primary);
});

it('shows a clearly outlined consent box and a red wallet setup action', () => {
  render(
    <PiggyvestWalletSetupForm
      colors={Colors.dark}
      merchantId="merchant"
      onSubmit={jest.fn()}
    />
  );
  const checkbox = screen.getByRole('checkbox');
  expect(screen.getByTestId('wallet-consent-indicator')).toHaveStyle({
    width: 28,
    height: 28,
    borderWidth: 2,
  });
  expect(checkbox.props.accessibilityState.checked).toBe(false);
  fireEvent.press(checkbox);
  expect(checkbox.props.accessibilityState.checked).toBe(true);
  expect(screen.getByTestId('wallet-consent-indicator')).toHaveStyle({
    backgroundColor: BRAND.primary,
  });
  expect(
    screen.getByRole('button', { name: 'Create account number' })
  ).toHaveStyle({ backgroundColor: BRAND.primary });
});
