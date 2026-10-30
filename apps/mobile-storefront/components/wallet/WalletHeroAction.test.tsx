import { fireEvent, render, screen } from '@testing-library/react-native';
import { WalletHeroAction } from './WalletHeroAction';

it.each([
  ['not_started', 'Create account number'],
  ['processing', 'View progress'],
  ['checking', 'Check account'],
  ['unavailable', 'Complete setup'],
] as const)('opens the appropriate next step for %s', (setupState, label) => {
  const onPress = jest.fn();
  render(
    <WalletHeroAction
      hasAccount={false}
      setupState={setupState}
      onPress={onPress}
    />
  );
  fireEvent.press(screen.getByRole('button', { name: label }));
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Add Money')).toBeNull();
});

it('switches to Add Money as soon as the account becomes ready', () => {
  const onPress = jest.fn();
  const { rerender } = render(
    <WalletHeroAction
      hasAccount={false}
      setupState="processing"
      onPress={onPress}
    />
  );
  rerender(
    <WalletHeroAction hasAccount setupState="ready" onPress={onPress} />
  );
  fireEvent.press(screen.getByRole('button', { name: 'Add money' }));
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('View progress')).toBeNull();
});
