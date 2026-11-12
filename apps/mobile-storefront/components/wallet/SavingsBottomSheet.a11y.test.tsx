import { fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import Colors from '@/constants/Colors';
import { SavingsBottomSheet } from './SavingsBottomSheet';
import { EmbeddedPinStep } from './savings/WalletPinEmbeddedStep';

jest.mock('@gorhom/bottom-sheet', () => ({
  ...jest.requireActual('@gorhom/bottom-sheet'),
  useBottomSheet: () => ({ snapToIndex: jest.fn(), snapToPosition: jest.fn() }),
}));

function renderSheet(withPin: boolean) {
  return render(
    <SavingsBottomSheet
      colors={Colors.light}
      onClose={jest.fn()}
      overlay={
        withPin ? (
          <EmbeddedPinStep colors={Colors.light} onParentClose={jest.fn()}>
            <Text>PIN step</Text>
          </EmbeddedPinStep>
        ) : null
      }
      visible
    >
      <Pressable accessibilityRole="button" accessibilityLabel="Add ₦2,500">
        <Text>Add</Text>
      </Pressable>
    </SavingsBottomSheet>
  );
}

describe('bugfix: savings controls stayed reachable by screen readers under the PIN step', () => {
  it('hides the savings controls from VoiceOver and TalkBack while a PIN step is on top', () => {
    renderSheet(true);
    expect(screen.queryByRole('button', { name: 'Add ₦2,500' })).toBeNull();
    expect(
      screen.getByLabelText('Add ₦2,500', { includeHiddenElements: true })
    ).toBeTruthy();
  });

  it('leaves them reachable when no PIN step is showing', () => {
    renderSheet(false);
    fireEvent.press(screen.getByRole('button', { name: 'Add ₦2,500' }));
    expect(screen.getByRole('button', { name: 'Add ₦2,500' })).toBeTruthy();
  });
});
