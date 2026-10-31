import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderStatusDrawerFrame } from './OrderStatusDrawerFrame';

const windowDimensionsMock = vi.hoisted(() => ({
  height: 844,
  width: 390,
}));

const sheetMethods = vi.hoisted(() => ({
  close: vi.fn(),
  snapToIndex: vi.fn(),
}));

vi.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: ({ name }: { name: string }) => <span>{name}</span>,
  default: ({ name }: { name: string }) => <span>{name}</span>,
  __esModule: true,
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 8, right: 0, bottom: 12, left: 0 }),
}));

vi.mock('react-native-reanimated', () => ({
  useSharedValue: (value: unknown) => ({ value }),
}));

vi.mock('@gorhom/bottom-sheet', () => ({
  __esModule: true,
  default: ({
    android_keyboardInputMode,
    backdropComponent: BackdropComponent,
    children,
    containerLayoutState,
    enableDynamicSizing,
    enablePanDownToClose,
    index,
    keyboardBehavior,
    onChange,
    onClose,
    ref,
    snapPoints,
  }: {
    ref?: { current: unknown };
    android_keyboardInputMode?: string;
    backdropComponent?: (props: Record<string, unknown>) => ReactNode;
    children?: ReactNode;
    containerLayoutState?: unknown;
    enableDynamicSizing?: boolean;
    enablePanDownToClose?: boolean;
    index?: number;
    keyboardBehavior?: string;
    onChange?: (index: number) => void;
    onClose?: () => void;
    snapPoints?: number[];
  }) => {
    if (ref) ref.current = sheetMethods;
    return (
      <section
        aria-label="gorhom-status-drawer"
        data-android-keyboard-input-mode={android_keyboardInputMode ?? ''}
        data-has-container-layout-state={String(Boolean(containerLayoutState))}
        data-dynamic-sizing={String(Boolean(enableDynamicSizing))}
        data-index={index}
        data-keyboard-behavior={keyboardBehavior ?? ''}
        data-pan-down-close={String(Boolean(enablePanDownToClose))}
        data-snap-points={snapPoints?.join(',') ?? ''}
      >
        {BackdropComponent?.({})}
        {children}
        <button
          aria-label="Pan status drawer down"
          onClick={onClose}
          type="button"
        />
        <button
          aria-label="Move status drawer to open index"
          onClick={() => onChange?.(0)}
          type="button"
        />
      </section>
    );
  },
  BottomSheetBackdrop: ({
    onPress,
    pressBehavior,
  }: {
    onPress?: () => void;
    pressBehavior?: string;
  }) => (
    <button
      aria-label="Status drawer backdrop"
      data-press-behavior={pressBehavior}
      onClick={onPress}
      type="button"
    />
  ),
  BottomSheetView: ({
    children,
    testID,
  }: {
    children?: ReactNode;
    testID?: string;
  }) => <div data-testid={testID}>{children}</div>,
  BottomSheetScrollView: ({
    children,
    contentContainerStyle,
  }: {
    children?: ReactNode;
    contentContainerStyle?: unknown;
  }) => (
    <section
      aria-label="scrollable status drawer content"
      data-has-content-container-style={String(Boolean(contentContainerStyle))}
    >
      {children}
    </section>
  ),
}));

vi.mock('react-native', () => ({
  useWindowDimensions: () => windowDimensionsMock,
  Modal: ({
    children,
    visible,
  }: {
    children?: ReactNode;
    visible?: boolean;
  }) =>
    visible ? <section aria-label="status-modal">{children}</section> : null,
  Pressable: ({
    accessibilityLabel,
    children,
    onPress,
  }: {
    accessibilityLabel?: string;
    children?: ReactNode;
    onPress?: () => void;
  }) => (
    <button aria-label={accessibilityLabel} onClick={onPress} type="button">
      {children}
    </button>
  ),
  StyleSheet: {
    create: (styles: Record<string, unknown>) => styles,
    hairlineWidth: 1,
  },
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  View: ({
    accessibilityViewIsModal,
    children,
    importantForAccessibility,
    pointerEvents,
    style,
    testID,
  }: {
    accessibilityViewIsModal?: boolean;
    children?: ReactNode;
    importantForAccessibility?: string;
    pointerEvents?: string;
    style?: unknown;
    testID?: string;
  }) => {
    const getHeight = (styleValue: unknown): string => {
      if (Array.isArray(styleValue)) {
        return styleValue.map(getHeight).find(Boolean) ?? '';
      }

      if (
        styleValue &&
        typeof styleValue === 'object' &&
        'height' in styleValue
      ) {
        const height = (styleValue as { height?: unknown }).height;
        return height == null ? '' : String(height);
      }

      return '';
    };

    return (
      <div
        data-accessibility-view-is-modal={String(
          Boolean(accessibilityViewIsModal)
        )}
        data-important-for-accessibility={importantForAccessibility}
        data-pointer-events={pointerEvents}
        data-style-height={getHeight(style)}
        data-testid={testID}
      >
        {children}
      </div>
    );
  },
}));

const colors = {
  background: '#050713',
  border: '#26283a',
  card: '#18192a',
  text: '#ffffff',
  textMuted: '#94a3b8',
};

describe('OrderStatusDrawerFrame', () => {
  beforeEach(() => {
    windowDimensionsMock.height = 844;
    windowDimensionsMock.width = 390;
    sheetMethods.close.mockClear();
    sheetMethods.snapToIndex.mockClear();
  });

  it('slides the drawer closed instead of removing it instantly when hidden', () => {
    const props = {
      closeLabel: 'Close status sheet',
      colors,
      onClose: vi.fn(),
      title: 'Update Order Status',
    };
    const { rerender } = render(
      <OrderStatusDrawerFrame {...props} visible={true}>
        <span>Status rows</span>
      </OrderStatusDrawerFrame>
    );

    rerender(
      <OrderStatusDrawerFrame {...props} visible={false}>
        <span>Status rows</span>
      </OrderStatusDrawerFrame>
    );

    expect(sheetMethods.close).toHaveBeenCalled();
    expect(screen.getByLabelText('gorhom-status-drawer')).toBeInTheDocument();
  });

  it('removes the drawer once its close animation finishes', () => {
    const onClose = vi.fn();
    const props = {
      closeLabel: 'Close status sheet',
      colors,
      onClose,
      title: 'Update Order Status',
    };
    const { rerender } = render(
      <OrderStatusDrawerFrame {...props} visible={true}>
        <span>Status rows</span>
      </OrderStatusDrawerFrame>
    );
    rerender(
      <OrderStatusDrawerFrame {...props} visible={false}>
        <span>Status rows</span>
      </OrderStatusDrawerFrame>
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Pan status drawer down' })
    );

    expect(
      screen.queryByLabelText('gorhom-status-drawer')
    ).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders no overlay while hidden so the order screen remains touchable', () => {
    render(
      <OrderStatusDrawerFrame
        closeLabel="Close status sheet"
        colors={colors}
        onClose={vi.fn()}
        title="Update Order Status"
        visible={false}
      >
        <span>Status rows</span>
      </OrderStatusDrawerFrame>
    );

    expect(
      screen.queryByTestId('order-status-drawer-host')
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('status-modal')).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText('gorhom-status-drawer')
    ).not.toBeInTheDocument();
  });

  it('renders the Gorhom drawer with a numeric snap height when visible', () => {
    render(
      <OrderStatusDrawerFrame
        closeLabel="Close status sheet"
        contentRowCount={6}
        colors={colors}
        onClose={vi.fn()}
        title="Update Order Status"
        visible={true}
      >
        <span>Status rows</span>
      </OrderStatusDrawerFrame>
    );

    expect(screen.getByLabelText('gorhom-status-drawer')).toHaveAttribute(
      'data-dynamic-sizing',
      'false'
    );
    expect(screen.getByLabelText('gorhom-status-drawer')).toHaveAttribute(
      'data-index',
      '0'
    );
    expect(screen.getByLabelText('gorhom-status-drawer')).toHaveAttribute(
      'data-snap-points',
      '552,812'
    );
    expect(screen.getByLabelText('gorhom-status-drawer')).toHaveAttribute(
      'data-android-keyboard-input-mode',
      'adjustResize'
    );
    expect(screen.getByLabelText('gorhom-status-drawer')).toHaveAttribute(
      'data-has-container-layout-state',
      'true'
    );
    expect(screen.getByLabelText('gorhom-status-drawer')).toHaveAttribute(
      'data-keyboard-behavior',
      'interactive'
    );
    expect(screen.getByTestId('order-status-drawer-host')).toBeInTheDocument();
    expect(screen.getByLabelText('Status drawer backdrop')).toHaveAttribute(
      'data-press-behavior',
      'close'
    );
    expect(screen.getByTestId('order-status-drawer-host')).toHaveAttribute(
      'data-pointer-events',
      'box-none'
    );
    expect(screen.getByTestId('order-status-drawer-host')).toHaveAttribute(
      'data-style-height',
      '844'
    );
    expect(screen.getByTestId('order-status-drawer-host')).toHaveAttribute(
      'data-accessibility-view-is-modal',
      'true'
    );
    expect(screen.getByTestId('order-status-drawer-host')).toHaveAttribute(
      'data-important-for-accessibility',
      'yes'
    );
    expect(screen.queryByLabelText('status-modal')).not.toBeInTheDocument();
    expect(screen.getByText('Update Order Status')).toBeInTheDocument();
    expect(screen.getByText('Status rows')).toBeInTheDocument();
    expect(
      screen.getByLabelText('scrollable status drawer content')
    ).toHaveAttribute('data-has-content-container-style', 'true');
  });

  it('clamps the drawer snap height to the available viewport', () => {
    windowDimensionsMock.height = 360;

    render(
      <OrderStatusDrawerFrame
        closeLabel="Close status sheet"
        contentRowCount={6}
        colors={colors}
        onClose={vi.fn()}
        title="Update Order Status"
        visible={true}
      >
        <span>Status rows</span>
      </OrderStatusDrawerFrame>
    );

    expect(screen.getByLabelText('gorhom-status-drawer')).toHaveAttribute(
      'data-snap-points',
      '328'
    );
    expect(screen.getByTestId('order-status-drawer-host')).toHaveAttribute(
      'data-style-height',
      '360'
    );
  });

  it('closes from the header button, backdrop, and pan-down callback', () => {
    const onClose = vi.fn();

    render(
      <OrderStatusDrawerFrame
        closeLabel="Close status sheet"
        colors={colors}
        onClose={onClose}
        title="Update Order Status"
        visible={true}
      >
        <span>Status rows</span>
      </OrderStatusDrawerFrame>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close status sheet' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Status drawer backdrop' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Pan status drawer down' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Move status drawer to open index' })
    );

    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
