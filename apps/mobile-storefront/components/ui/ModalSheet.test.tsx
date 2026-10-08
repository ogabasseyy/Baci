import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Button, Text } from 'react-native';
import { useKeyboard } from '@/hooks/use-keyboard';
import { ModalSheet } from './ModalSheet';

jest.mock('@/hooks/use-keyboard', () => ({
  useKeyboard: jest.fn(() => ({ keyboardHeight: 0 })),
}));

describe('ModalSheet', () => {
  it('covers the transparent keyboard padding with the requested theme surface', () => {
    const keyboard = jest.mocked(useKeyboard);
    keyboard.mockReturnValueOnce({
      ...keyboard(),
      keyboardHeight: 320,
    });
    const { rerender } = render(
      <ModalSheet keyboardSurfaceColor="#101010" visible>
        <Text>Amount form</Text>
      </ModalSheet>
    );

    expect(screen.getByTestId('modal-keyboard-surface')).toHaveStyle({
      position: 'absolute',
      bottom: 0,
      height: 320,
      backgroundColor: '#101010',
      pointerEvents: 'none',
    });

    rerender(
      <ModalSheet keyboardSurfaceColor="#101010" visible>
        <Text>Amount form</Text>
      </ModalSheet>
    );
    expect(screen.queryByTestId('modal-keyboard-surface')).toBeNull();
  });

  it('does not add an opaque keyboard surface to sheets that have not opted in', () => {
    const keyboard = jest.mocked(useKeyboard);
    keyboard.mockReturnValueOnce({ ...keyboard(), keyboardHeight: 320 });
    render(
      <ModalSheet visible>
        <Text>Other sheet</Text>
      </ModalSheet>
    );

    expect(screen.queryByTestId('modal-keyboard-surface')).toBeNull();
  });

  it('renders modal sheet content when visible', () => {
    render(
      <ModalSheet backdropStyle={{}} cardStyle={{}} visible>
        <Text>Sheet content</Text>
      </ModalSheet>
    );

    expect(screen.getByText('Sheet content')).toBeOnTheScreen();
  });

  it('wraps sheet content in a keyboard-avoiding container', () => {
    render(
      <ModalSheet visible>
        <Text>Sheet content</Text>
      </ModalSheet>
    );

    expect(screen.getByTestId('keyboard-container')).toContainElement(
      screen.getByText('Sheet content')
    );
  });

  it('supports the modal-aware keyboard offset for a bottom sheet', () => {
    render(
      <ModalSheet keyboardAutomaticOffset visible>
        <Text>Keyboard-aware sheet</Text>
      </ModalSheet>
    );

    expect(screen.getByTestId('keyboard-container')).toHaveProp(
      'automaticOffset',
      true
    );
  });

  it('uses default backdrop and card styles when style props are omitted', () => {
    render(
      <ModalSheet visible>
        <Text>Default styled content</Text>
      </ModalSheet>
    );

    expect(screen.getByText('Default styled content')).toBeOnTheScreen();
  });

  it('does not render modal sheet content when hidden', () => {
    render(
      <ModalSheet backdropStyle={{}} cardStyle={{}} visible={false}>
        <Text>Hidden content</Text>
      </ModalSheet>
    );

    expect(screen.queryByText('Hidden content')).not.toBeOnTheScreen();
  });

  it('calls backdrop and request-close handlers when the dismiss backdrop is pressed', () => {
    const onRequestClose = jest.fn();
    const onBackdropPress = jest.fn();
    render(
      <ModalSheet
        backdropStyle={{}}
        cardStyle={{}}
        onBackdropPress={onBackdropPress}
        onRequestClose={onRequestClose}
        visible
      >
        <Text>Dismissable content</Text>
      </ModalSheet>
    );

    fireEvent.press(screen.getByLabelText('Dismiss modal'));

    expect(onBackdropPress).toHaveBeenCalledTimes(1);
    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });

  it('does not dismiss when pressing content inside the sheet', () => {
    const onRequestClose = jest.fn();
    const onBackdropPress = jest.fn();
    const onSheetAction = jest.fn();
    render(
      <ModalSheet
        backdropStyle={{}}
        cardStyle={{}}
        onBackdropPress={onBackdropPress}
        onRequestClose={onRequestClose}
        visible
      >
        <Button title="Sheet action" onPress={onSheetAction} />
      </ModalSheet>
    );

    fireEvent.press(screen.getByRole('button', { name: 'Sheet action' }));

    expect(onSheetAction).toHaveBeenCalled();
    expect(onBackdropPress).not.toHaveBeenCalled();
    expect(onRequestClose).not.toHaveBeenCalled();
  });
});
