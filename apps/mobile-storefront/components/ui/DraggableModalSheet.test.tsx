import { fireEvent, render, screen } from '@testing-library/react-native';
import { Button, Modal, Text, TextInput } from 'react-native';
import { BRAND } from '@/constants/Colors';
import { DraggableModalSheet } from './DraggableModalSheet';

describe('DraggableModalSheet', () => {
  it('keeps wallet form controls individually accessible instead of grouping the entire sheet', () => {
    const onSubmit = jest.fn();
    render(
      <DraggableModalSheet visible backgroundColor="#111" onClose={jest.fn()}>
        <TextInput accessibilityLabel="Contribution amount" />
        <Button title="Add to savings" onPress={onSubmit} />
      </DraggableModalSheet>
    );

    expect(screen.getByTestId('gorhom-sheet')).toHaveProp('accessible', false);
    expect(screen.getByLabelText('Contribution amount')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Add to savings' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('resets native sheet geometry when switching from savings to wallet setup', () => {
    const onClose = jest.fn();
    const { rerender } = render(
      <DraggableModalSheet visible backgroundColor="#111" onClose={onClose}>
        <Text>Savings contribution</Text>
      </DraggableModalSheet>
    );
    const savingsSheet = screen.getByTestId('gorhom-sheet');
    rerender(
      <DraggableModalSheet
        fitContent
        visible
        backgroundColor="#111"
        onClose={onClose}
      >
        <Text>Wallet setup</Text>
      </DraggableModalSheet>
    );
    expect(screen.getByTestId('gorhom-sheet')).not.toBe(savingsSheet);
    expect(screen.getByTestId('gorhom-sheet').props.enableDynamicSizing).toBe(
      true
    );
    expect(onClose).not.toHaveBeenCalled();
  });
  it('fits short wallet forms without retaining oversized percentage snap points', () => {
    render(
      <DraggableModalSheet
        fitContent
        visible
        backgroundColor="#111"
        onClose={jest.fn()}
      >
        <Text>Wallet setup</Text>
      </DraggableModalSheet>
    );
    const sheet = screen.getByTestId('gorhom-sheet');
    expect(sheet.props.enableDynamicSizing).toBe(true);
    expect(sheet.props.snapPoints).toBeUndefined();
    expect(sheet.props.maxDynamicContentSize).toBeGreaterThan(0);
    expect(sheet.props.keyboardBehavior).toBe('interactive');
    expect(sheet.props.detached).toBe(false);
    expect(sheet.props.bottomInset).toBe(0);
    expect(sheet.props.backgroundStyle).toMatchObject({
      borderBottomLeftRadius: 0,
      borderBottomRightRadius: 0,
    });
    expect(sheet.props.enablePanDownToClose).toBe(true);
  });
  it('renders embedded content without mounting a second native modal or sheet', () => {
    render(
      <DraggableModalSheet
        embedded
        visible
        backgroundColor="#111"
        onClose={jest.fn()}
      >
        <Text>Embedded wallet step</Text>
      </DraggableModalSheet>
    );
    expect(screen.getByText('Embedded wallet step')).toBeOnTheScreen();
    expect(screen.UNSAFE_queryAllByType(Modal)).toHaveLength(0);
    expect(screen.queryByTestId('gorhom-sheet')).toBeNull();
  });
  it('defaults storefront drawers to a red outline and drag handle', () => {
    render(
      <DraggableModalSheet backgroundColor="#111" onClose={jest.fn()} visible>
        <Text>Default drawer</Text>
      </DraggableModalSheet>
    );
    const sheet = screen.getByTestId('gorhom-sheet');
    expect(sheet.props.backgroundStyle).toMatchObject({
      borderColor: BRAND.primary,
      borderWidth: 1.5,
    });
    expect(sheet.props.handleIndicatorStyle).toMatchObject({
      backgroundColor: BRAND.primary,
    });
  });
  it('applies an optional outline and matching drag handle', () => {
    render(
      <DraggableModalSheet
        backgroundColor="#111"
        borderColor="#dc2626"
        handleColor="#dc2626"
        onClose={jest.fn()}
        visible
      >
        <Text>Contribution</Text>
      </DraggableModalSheet>
    );
    expect(
      screen.getByTestId('gorhom-sheet').props.backgroundStyle
    ).toMatchObject({
      borderColor: '#dc2626',
      borderWidth: 1.5,
    });
    expect(
      screen.getByTestId('gorhom-sheet').props.handleIndicatorStyle
    ).toMatchObject({
      backgroundColor: '#dc2626',
    });
  });
  it('handles the native back action without starting a contribution', () => {
    const onClose = jest.fn();
    const { UNSAFE_getByType } = render(
      <DraggableModalSheet
        backgroundColor="#111"
        handleColor="#aaa"
        onClose={onClose}
        visible
      >
        <Text>Contribution</Text>
      </DraggableModalSheet>
    );
    fireEvent(UNSAFE_getByType(Modal), 'requestClose');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  const props = {
    backgroundColor: '#111',
    handleColor: '#aaa',
    onClose: jest.fn(),
    visible: true,
  };

  it('supports dragging, keyboard restoration and swipe-down dismissal', () => {
    const onClose = jest.fn();
    render(
      <DraggableModalSheet {...props} onClose={onClose}>
        <Text>Contribution</Text>
      </DraggableModalSheet>
    );
    const sheet = screen.getByTestId('gorhom-sheet');
    expect(sheet.props).toMatchObject({
      snapPoints: ['75%', '92%'],
      enablePanDownToClose: true,
      enableBlurKeyboardOnGesture: true,
      keyboardBlurBehavior: 'restore',
      android_keyboardInputMode: 'adjustResize',
    });
    fireEvent(sheet, 'change', 1);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent(sheet, 'change', -1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('unmounts hidden content and reopens the sheet on the next visit', () => {
    const { rerender } = render(
      <DraggableModalSheet {...props} visible={false}>
        <Text>Contribution</Text>
      </DraggableModalSheet>
    );
    expect(screen.queryByText('Contribution')).toBeNull();
    rerender(
      <DraggableModalSheet {...props}>
        <Text>Contribution</Text>
      </DraggableModalSheet>
    );
    expect(screen.getByText('Contribution')).toBeOnTheScreen();
    expect(screen.getByTestId('gorhom-sheet').props.index).toBe(0);
  });
});
