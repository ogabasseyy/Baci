import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppSheetModal } from '@/components/ui/AppSheetModal';

const keyboardContainerProps = vi.hoisted(() => ({
  bottomFillColor: undefined as string | undefined,
  contentContainerStyle: undefined as unknown,
  keyboardVerticalOffset: 0,
  scrollEnabled: true,
}));

function Text({ children }: { children?: React.ReactNode }) {
  return <span>{children}</span>;
}

vi.mock('@/components/ui/AppKeyboardContainer', () => ({
  AppKeyboardContainer: ({
    bottomFillColor,
    children,
    contentContainerStyle,
    keyboardVerticalOffset,
    scrollEnabled,
  }: {
    bottomFillColor?: string;
    children?: React.ReactNode;
    contentContainerStyle?: unknown;
    keyboardVerticalOffset?: number;
    scrollEnabled?: boolean;
  }) => {
    keyboardContainerProps.bottomFillColor = bottomFillColor;
    keyboardContainerProps.contentContainerStyle = contentContainerStyle;
    keyboardContainerProps.keyboardVerticalOffset = keyboardVerticalOffset ?? 0;
    keyboardContainerProps.scrollEnabled = scrollEnabled ?? true;
    return <section aria-label="keyboard-container">{children}</section>;
  },
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#101010',
      backdrop: 'rgba(0, 0, 0, 0.55)',
      border: '#202020',
      card: '#303030',
    },
    shadows: {
      lg: { boxShadow: '0 8px 24px rgba(0,0,0,0.2)' },
    },
  }),
}));

vi.mock('react-native', () => {
  return {
    StatusBar: () => null,
    Modal: ({
      children,
      visible,
    }: {
      children?: React.ReactNode;
      visible?: boolean;
    }) =>
      visible ? <section aria-label="sheet-modal">{children}</section> : null,
    Pressable: ({
      accessibilityLabel,
      children,
      onPress,
      testID,
    }: {
      accessibilityLabel?: string;
      children?: React.ReactNode;
      onPress?: () => void;
      testID?: string;
    }) => (
      <button
        aria-label={accessibilityLabel}
        data-testid={testID}
        onClick={onPress}
        type="button"
      >
        {children}
      </button>
    ),
    StyleSheet: {
      absoluteFillObject: { position: 'absolute', inset: 0 },
      create: (styles: Record<string, unknown>) => styles,
    },
    View: ({
      accessibilityLabel,
      children,
    }: {
      accessibilityLabel?: string;
      children?: React.ReactNode;
    }) => <section aria-label={accessibilityLabel}>{children}</section>,
  };
});

describe('AppSheetModal', () => {
  beforeEach(() => {
    keyboardContainerProps.bottomFillColor = undefined;
    keyboardContainerProps.contentContainerStyle = undefined;
    keyboardContainerProps.keyboardVerticalOffset = 0;
    keyboardContainerProps.scrollEnabled = true;
  });

  it('renders children inside the sheet shell when visible', () => {
    render(
      <AppSheetModal
        accessibilityLabel="Staff account sheet"
        onClose={vi.fn()}
        visible={true}
      >
        <Text>Sheet content</Text>
      </AppSheetModal>
    );

    expect(screen.getByLabelText('sheet-modal')).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Staff account sheet' })
    ).toBeInTheDocument();
    expect(screen.getByText('Sheet content')).toBeInTheDocument();
  });

  it('dismisses on backdrop press by default', () => {
    const onClose = vi.fn();

    render(
      <AppSheetModal
        accessibilityLabel="Dismissable sheet"
        onClose={onClose}
        visible={true}
      >
        <Text>Dismiss me</Text>
      </AppSheetModal>
    );

    fireEvent.click(screen.getByTestId('app-sheet-backdrop'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dismisses when pressing the visible space above the sheet', () => {
    const onClose = vi.fn();

    render(
      <AppSheetModal
        accessibilityLabel="Dismissable sheet"
        onClose={onClose}
        visible={true}
      >
        <Text>Dismiss me</Text>
      </AppSheetModal>
    );

    fireEvent.click(screen.getByTestId('app-sheet-dismiss-area'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('can disable backdrop dismissal', () => {
    const onClose = vi.fn();

    render(
      <AppSheetModal
        accessibilityLabel="Persistent sheet"
        dismissOnBackdropPress={false}
        onClose={onClose}
        visible={true}
      >
        <Text>Persistent</Text>
      </AppSheetModal>
    );

    fireEvent.click(screen.getByTestId('app-sheet-backdrop'));
    fireEvent.click(screen.getByTestId('app-sheet-dismiss-area'));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('forwards keyboard container configuration', () => {
    render(
      <AppSheetModal
        accessibilityLabel="Configured sheet"
        keyboardVerticalOffset={64}
        onClose={vi.fn()}
        presentation="detached"
        scrollEnabled={false}
        visible={true}
      >
        <Text>Configured</Text>
      </AppSheetModal>
    );

    expect(
      screen.getByRole('region', { name: 'keyboard-container' })
    ).toBeInTheDocument();
    expect(keyboardContainerProps.keyboardVerticalOffset).toBe(64);
    expect(keyboardContainerProps.scrollEnabled).toBe(false);
    expect(keyboardContainerProps.contentContainerStyle).toBeTruthy();
  });
  describe('bugfix: an attached sheet left a gap under it', () => {
    it('fills the bottom safe area with the sheet colour when attached', () => {
      render(
        <AppSheetModal
          accessibilityLabel="Attached sheet"
          onClose={vi.fn()}
          visible={true}
        >
          <Text>Attached</Text>
        </AppSheetModal>
      );

      expect(keyboardContainerProps.bottomFillColor).toBe('#303030');
    });

    it('lets a detached sheet float over the backdrop', () => {
      render(
        <AppSheetModal
          accessibilityLabel="Detached sheet"
          onClose={vi.fn()}
          presentation="detached"
          visible={true}
        >
          <Text>Detached</Text>
        </AppSheetModal>
      );

      expect(keyboardContainerProps.bottomFillColor).toBeUndefined();
    });
  });
});
