import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import Colors from '@/constants/Colors';
import { SavingsBottomSheet } from './SavingsBottomSheet';
import { EmbeddedPinStep } from './savings/WalletPinEmbeddedStep';

jest.mock('@gorhom/bottom-sheet', () => ({
  ...jest.requireActual('@gorhom/bottom-sheet'),
  useBottomSheet: () => ({ snapToIndex: jest.fn(), snapToPosition: jest.fn() }),
}));

// The shared mock's snapToIndex outlives a test: clear it so a resnap from
// an earlier test can never satisfy this file's last-call assertion.
beforeEach(() => {
  (
    jest.requireMock('@gorhom/bottom-sheet') as {
      mockBottomSheetSnapToIndex: jest.Mock;
    }
  ).mockBottomSheetSnapToIndex.mockClear();
});

function renderSheet(overlay: React.ReactNode) {
  const onClose = jest.fn();
  render(
    <SavingsBottomSheet
      colors={Colors.light}
      onClose={onClose}
      overlay={overlay}
      visible
    >
      <Text>Add to savings</Text>
    </SavingsBottomSheet>
  );
  return { onClose };
}

describe('bugfix: closing the savings sheet left its PIN step waiting', () => {
  it('cancels the embedded PIN step before closing (swipe down, backdrop, Back)', () => {
    const order: string[] = [];
    const cancel = jest.fn(() => order.push('cancel'));
    const { onClose } = renderSheet(
      <EmbeddedPinStep colors={Colors.light} onParentClose={cancel}>
        <Text>PIN step</Text>
      </EmbeddedPinStep>
    );
    onClose.mockImplementation(() => order.push('close'));
    fireEvent(screen.getByTestId('gorhom-bottom-sheet'), 'close');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['cancel', 'close']);
  });

  it('just closes when no PIN step is showing', () => {
    const { onClose } = renderSheet(null);
    fireEvent(screen.getByTestId('gorhom-bottom-sheet'), 'close');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('bugfix: the PIN step closed the whole savings sheet', () => {
  it('fits the sheet to the PIN step through its snap point, without closing it', () => {
    const { onClose } = renderSheet(
      <EmbeddedPinStep colors={Colors.light}>
        <Text>PIN step</Text>
      </EmbeddedPinStep>
    );
    const sheet = () => screen.getByTestId('gorhom-bottom-sheet');
    fireEvent(screen.getByTestId('pin-step-content'), 'layout', {
      nativeEvent: { layout: { height: 500 } },
    });
    const [only, ...rest] = sheet().props.snapPoints as number[];
    expect(rest).toHaveLength(0);
    expect(only).toBeGreaterThan(500);
    // It moves to that real snap point (index 0), never a temporary position.
    const { mockBottomSheetSnapToIndex } = jest.requireMock(
      '@gorhom/bottom-sheet'
    ) as { mockBottomSheetSnapToIndex: jest.Mock };
    expect(mockBottomSheetSnapToIndex).toHaveBeenCalled();
    expect(mockBottomSheetSnapToIndex).toHaveBeenLastCalledWith(0);
    expect(onClose).not.toHaveBeenCalled();
  });
});
