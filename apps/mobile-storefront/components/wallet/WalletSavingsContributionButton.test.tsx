import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { palette } from '@/constants/Colors';
import { WalletSavingsContributionButton } from './WalletSavingsContributionButton';

describe('WalletSavingsContributionButton', () => {
  it('uses a solid readable green action and confirms the contribution', () => {
    const onPress = jest.fn();
    render(
      <WalletSavingsContributionButton
        disabled={false}
        isAdding={false}
        onPress={onPress}
      />
    );

    expect(
      StyleSheet.flatten(
        screen.getByRole('button', { name: 'Confirm savings top-up' }).props
          .style
      )
    ).toEqual(
      expect.objectContaining({ backgroundColor: palette.emerald[800] })
    );
    expect(screen.getByText('Add to savings')).toBeOnTheScreen();
    fireEvent.press(
      screen.getByRole('button', { name: 'Confirm savings top-up' })
    );
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('keeps focus visible and disables duplicate contributions while adding', () => {
    const onPress = jest.fn();
    const { rerender } = render(
      <WalletSavingsContributionButton
        disabled={false}
        isAdding={false}
        onPress={onPress}
      />
    );
    const button = screen.getByRole('button', {
      name: 'Confirm savings top-up',
    });
    fireEvent(button, 'focus');
    expect(StyleSheet.flatten(button.props.style)).toEqual(
      expect.objectContaining({ borderColor: palette.white, borderWidth: 2 })
    );

    rerender(
      <WalletSavingsContributionButton
        disabled={false}
        isAdding
        onPress={onPress}
      />
    );
    expect(screen.getByText('Adding...')).toBeOnTheScreen();
    expect(button).toHaveAccessibilityState({ disabled: true, busy: true });
    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });
});
