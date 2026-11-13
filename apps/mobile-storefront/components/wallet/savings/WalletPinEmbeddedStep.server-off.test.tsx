import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import Colors from '@/constants/Colors';
import { SavingsSheetPinHeightContext } from '../SavingsSheetPinCancelContext';
import { EmbeddedPinStep } from './WalletPinEmbeddedStep';

const mockSnapToPosition = jest.fn();
jest.mock('@gorhom/bottom-sheet', () => ({
  useBottomSheet: () => ({
    snapToPosition: mockSnapToPosition,
    snapToIndex: jest.fn(),
  }),
}));

// Pure layout: it only tells the savings sheet how tall to be, never calls a
// server, so it behaves the same whether PiggyVest is on or off.
describe('EmbeddedPinStep', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reports its height to the sheet and clears it when it closes', () => {
    const setHeight = jest.fn();
    const view = render(
      <SavingsSheetPinHeightContext.Provider value={setHeight}>
        <EmbeddedPinStep colors={Colors.light}>
          <Text>step</Text>
        </EmbeddedPinStep>
      </SavingsSheetPinHeightContext.Provider>
    );
    fireEvent(screen.getByTestId('pin-step-content'), 'layout', {
      nativeEvent: { layout: { height: 400.2 } },
    });
    expect(setHeight).toHaveBeenLastCalledWith(401);
    view.unmount();
    expect(setHeight).toHaveBeenLastCalledWith(0);
  });

  it('never moves the sheet to a temporary position (Gorhom reads that as closed)', () => {
    render(
      <SavingsSheetPinHeightContext.Provider value={jest.fn()}>
        <EmbeddedPinStep colors={Colors.light}>
          <Text>step</Text>
        </EmbeddedPinStep>
      </SavingsSheetPinHeightContext.Provider>
    );
    fireEvent(screen.getByTestId('pin-step-content'), 'layout', {
      nativeEvent: { layout: { height: 400 } },
    });
    expect(mockSnapToPosition).not.toHaveBeenCalled();
  });
});
