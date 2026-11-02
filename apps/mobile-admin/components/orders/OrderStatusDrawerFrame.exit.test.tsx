import '@testing-library/jest-dom/vitest';
import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SHEET_EXIT_FALLBACK_MS } from '@/hooks/useSheetExitPresence';
import {
  ORDER_STATUS_DRAWER_EXIT_FALLBACK_MS,
  OrderStatusDrawerFrame,
} from './OrderStatusDrawerFrame';

const { passThrough } = vi.hoisted(() => ({
  passThrough: ({ children }: { children?: ReactNode }) => children ?? null,
}));

vi.mock('@react-native-vector-icons/ionicons', () => ({
  __esModule: true,
  default: () => null,
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
    children,
    ref,
  }: {
    children?: ReactNode;
    ref?: { current: unknown };
  }) => {
    if (ref) ref.current = { close: vi.fn(), snapToIndex: vi.fn() };
    return <section aria-label="gorhom-status-drawer">{children}</section>;
  },
  BottomSheetBackdrop: () => null,
  BottomSheetScrollView: passThrough,
  BottomSheetView: passThrough,
}));

vi.mock('react-native', () => ({
  Modal: ({
    children,
    visible,
  }: {
    children?: ReactNode;
    visible?: boolean;
  }) =>
    visible ? <section aria-label="status-modal">{children}</section> : null,
  Pressable: passThrough,
  StyleSheet: {
    create: (styles: Record<string, unknown>) => styles,
    hairlineWidth: 1,
  },
  Text: passThrough,
  View: passThrough,
  useWindowDimensions: () => ({ height: 844, width: 390 }),
}));

const props = {
  closeLabel: 'Close status sheet',
  colors: {
    background: '#050713',
    border: '#26283a',
    card: '#18192a',
    text: '#ffffff',
    textMuted: '#94a3b8',
  },
  onClose: vi.fn(),
  title: 'Update Order Status',
};

describe('OrderStatusDrawerFrame exit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not cut the drawer close short at the default sheet bound', () => {
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

    act(() => {
      vi.advanceTimersByTime(SHEET_EXIT_FALLBACK_MS);
    });
    expect(screen.getByLabelText('gorhom-status-drawer')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(
        ORDER_STATUS_DRAWER_EXIT_FALLBACK_MS - SHEET_EXIT_FALLBACK_MS
      );
    });
    expect(
      screen.queryByLabelText('gorhom-status-drawer')
    ).not.toBeInTheDocument();
  });
});
