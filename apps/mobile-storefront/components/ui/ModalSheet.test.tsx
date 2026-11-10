import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Button, Modal, Text } from 'react-native';
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

  it('fades the backdrop in place instead of sliding it when opted in', () => {
    const { UNSAFE_getByType } = render(
      <ModalSheet presentation="fade-backdrop" visible>
        <Text>Faded sheet</Text>
      </ModalSheet>
    );

    expect(screen.getByText('Faded sheet')).toBeOnTheScreen();
    expect(UNSAFE_getByType(Modal).props.animationType).toBe('fade');
  });

  it('slides the faded sheet down before unmounting it on close', () => {
    jest.useFakeTimers();
    try {
      const { UNSAFE_getByType, rerender } = render(
        <ModalSheet presentation="fade-backdrop" visible>
          <Text>Closing sheet</Text>
        </ModalSheet>
      );
      rerender(
        <ModalSheet presentation="fade-backdrop" visible={false}>
          <Text>Closing sheet</Text>
        </ModalSheet>
      );
      // Still mounted while the card slides back down.
      expect(UNSAFE_getByType(Modal).props.visible).toBe(true);

      act(() => {
        jest.advanceTimersByTime(1000);
      });

      expect(UNSAFE_getByType(Modal).props.visible).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('reports when the closing slide has finished', () => {
    jest.useFakeTimers();
    try {
      const onClosed = jest.fn();
      const { rerender } = render(
        <ModalSheet presentation="fade-backdrop" visible onClosed={onClosed}>
          <Text>Sheet</Text>
        </ModalSheet>
      );
      rerender(
        <ModalSheet
          presentation="fade-backdrop"
          visible={false}
          onClosed={onClosed}
        >
          <Text>Sheet</Text>
        </ModalSheet>
      );
      expect(onClosed).not.toHaveBeenCalled();
      act(() => {
        jest.advanceTimersByTime(1000);
      });
      expect(onClosed).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not report a close when it mounts already closed', () => {
    jest.useFakeTimers();
    try {
      const onClosed = jest.fn();
      render(
        <ModalSheet
          presentation="fade-backdrop"
          visible={false}
          onClosed={onClosed}
        >
          <Text>Sheet</Text>
        </ModalSheet>
      );
      act(() => {
        jest.advanceTimersByTime(1000);
      });
      expect(onClosed).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('runs a shared backdrop and request-close handler only once', () => {
    const close = jest.fn();
    render(
      <ModalSheet visible onBackdropPress={close} onRequestClose={close}>
        <Text>Sheet</Text>
      </ModalSheet>
    );
    fireEvent.press(screen.getByRole('button', { name: 'Dismiss modal' }));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('keeps the native slide for sheets that have not opted in', () => {
    const { UNSAFE_getByType } = render(
      <ModalSheet visible>
        <Text>Sliding sheet</Text>
      </ModalSheet>
    );

    expect(UNSAFE_getByType(Modal).props.animationType).toBe('slide');
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
