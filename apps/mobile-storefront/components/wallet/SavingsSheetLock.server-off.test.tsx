import { BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import Colors from '@/constants/Colors';
import { SavingsBottomSheet } from './SavingsBottomSheet';
import { useSavingsSheetLock } from './SavingsSheetLock';

const backdropPress = () =>
  screen.UNSAFE_getByType(BottomSheetBackdrop).props.pressBehavior;

function SavingStep({ saving }: { saving: boolean }) {
  useSavingsSheetLock(saving);
  return <Text>Pick an option</Text>;
}

function renderSheet(saving: boolean) {
  return render(
    <SavingsBottomSheet colors={Colors.light} onClose={jest.fn()} visible>
      <SavingStep saving={saving} />
    </SavingsBottomSheet>
  );
}

// Saving a phone option happens on the server whether or not PiggyVest is
// on: while it saves, the sheet must not close and let it start again.
describe('savings sheet lock with the server off', () => {
  it('keeps the sheet open while a step is saving', () => {
    renderSheet(true);
    const sheet = screen.getByTestId('gorhom-bottom-sheet');
    expect(sheet.props.enablePanDownToClose).toBe(false);
    expect(backdropPress()).toBe('none');
  });

  it('lets the sheet close again once the save is over', () => {
    const view = renderSheet(true);
    view.rerender(
      <SavingsBottomSheet colors={Colors.light} onClose={jest.fn()} visible>
        <SavingStep saving={false} />
      </SavingsBottomSheet>
    );
    expect(
      screen.getByTestId('gorhom-bottom-sheet').props.enablePanDownToClose
    ).toBe(true);
    expect(backdropPress()).toBe('close');
  });

  it('does nothing outside a savings sheet', () => {
    render(<SavingStep saving />);
    expect(screen.getByText('Pick an option')).toBeTruthy();
  });
});
