import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import Colors from '@/constants/Colors';
import { EmbeddedPinStep } from './WalletPinEmbeddedStep';

const mockSnapToPosition = jest.fn();
const mockSnapToIndex = jest.fn();
jest.mock('@gorhom/bottom-sheet', () => ({
  useBottomSheet: () => ({
    snapToPosition: mockSnapToPosition,
    snapToIndex: mockSnapToIndex,
  }),
}));

// Pure layout: it only resizes the savings sheet it sits in, never calls a
// server, so it behaves the same whether PiggyVest is on or off.
describe('EmbeddedPinStep', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sizes the sheet to its content and restores it when it closes', () => {
    const view = render(
      <EmbeddedPinStep colors={Colors.light}>
        <Text>step</Text>
      </EmbeddedPinStep>
    );
    fireEvent(screen.getByTestId('pin-step-content'), 'layout', {
      nativeEvent: { layout: { height: 400.2 } },
    });
    expect(mockSnapToPosition).toHaveBeenLastCalledWith(473);
    view.unmount();
    expect(mockSnapToIndex).toHaveBeenCalledWith(0);
  });
});
