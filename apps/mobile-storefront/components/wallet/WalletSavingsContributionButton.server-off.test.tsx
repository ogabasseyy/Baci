import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import Colors from '@/constants/Colors';
import { WalletSavingsContributionButton } from './WalletSavingsContributionButton';

it.each([
  Colors.light,
  Colors.dark,
])('follows the selected wallet theme for the primary action', (colors) => {
  render(
    <WalletSavingsContributionButton
      colors={colors}
      disabled={false}
      isAdding={false}
      onPress={jest.fn()}
    />
  );
  const button = screen.getByRole('button', {
    name: 'Confirm savings top-up',
  });
  expect(StyleSheet.flatten(button.props.style).backgroundColor).toBe(
    colors.primary
  );
  expect(screen.getByText('Add to savings')).toHaveStyle({
    color: colors.primaryForeground,
  });
});
