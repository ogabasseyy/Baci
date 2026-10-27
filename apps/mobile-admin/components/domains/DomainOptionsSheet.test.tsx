import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DomainOptionsSheet from './DomainOptionsSheet';
import type { Domain } from './domain-types';

const mocks = vi.hoisted(() => ({
  interactionCallback: null as null | (() => void),
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#ffffff',
      border: '#e2e8f0',
      card: '#f8fafc',
      error: '#dc2626',
      errorLight: '#fee2e2',
      primary: '#2563eb',
      primaryLight: '#dbeafe',
      success: '#16a34a',
      successLight: '#dcfce7',
      text: '#0f172a',
      textMuted: '#64748b',
      textSecondary: '#334155',
      warning: '#ca8a04',
      warningLight: '#fef9c3',
    },
    shadows: {
      lg: {},
    },
  }),
}));

vi.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: ({ name }: { name?: string }) => (
    <span aria-hidden="true" data-icon={name} />
  ),

  default: ({ name }: { name?: string }) => (
    <span aria-hidden="true" data-icon={name} />
  ),
  __esModule: true,
}));

vi.mock('react-native-reanimated', () => {
  const MockAnimatedView = ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  );

  return {
    default: {
      View: MockAnimatedView,
    },
    FadeIn: {},
    FadeOut: {},
    SlideInDown: {},
    SlideOutDown: {},
  };
});

vi.mock('react-native', () => ({
  Modal: ({
    children,
    visible,
  }: {
    children?: ReactNode;
    visible?: boolean;
  }) => (visible ? <div>{children}</div> : null),
  Pressable: ({
    accessibilityLabel,
    children,
    onPress,
    style,
  }: {
    accessibilityLabel?: string;
    children?: ReactNode;
    onPress?: () => void;
    style?: unknown;
  }) => {
    const resolvedStyle =
      typeof style === 'function' ? style({ pressed: false }) : style;
    return (
      <button
        type="button"
        aria-label={accessibilityLabel}
        data-has-style={Boolean(resolvedStyle)}
        onClick={() => onPress?.()}
      >
        {children}
      </button>
    );
  },
  StyleSheet: {
    absoluteFillObject: {},
    create: (styles: Record<string, unknown>) => styles,
  },
  StatusBar: () => null,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const baseDomain: Domain = {
  created_at: '2026-05-01T00:00:00Z',
  domain: 'shop.usebaci.com',
  domain_type: 'custom',
  id: 'domain_1',
  is_primary: false,
  status: 'pending',
};

describe('DomainOptionsSheet', () => {
  beforeEach(() => {
    vi.stubGlobal('requestIdleCallback', (callback: () => void) => {
      mocks.interactionCallback = callback;
      return 1;
    });
    vi.stubGlobal('cancelIdleCallback', () => {
      mocks.interactionCallback = null;
    });
  });
  afterEach(() => {
    cleanup();
    mocks.interactionCallback = null;
    vi.unstubAllGlobals();
  });

  it('runs selected action only after close and an idle callback', () => {
    const onAction = vi.fn();
    const onClose = vi.fn();

    const { rerender } = render(
      <DomainOptionsSheet
        visible
        domain={baseDomain}
        onClose={onClose}
        onAction={onAction}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Visit Site' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onAction).not.toHaveBeenCalled();

    rerender(
      <DomainOptionsSheet
        visible={false}
        domain={baseDomain}
        onClose={onClose}
        onAction={onAction}
      />
    );

    expect(mocks.interactionCallback).not.toBeNull();
    mocks.interactionCallback?.();

    expect(onAction).toHaveBeenCalledWith('visit', baseDomain);
  });

  it('ignores a pending action after unmount even if its callback runs late', () => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    const { rerender, unmount } = render(
      <DomainOptionsSheet
        visible
        domain={baseDomain}
        onClose={onClose}
        onAction={onAction}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Visit Site' }));
    rerender(
      <DomainOptionsSheet
        visible={false}
        domain={baseDomain}
        onClose={onClose}
        onAction={onAction}
      />
    );
    const lateCallback = mocks.interactionCallback;
    expect(lateCallback).not.toBeNull();
    unmount();
    expect(mocks.interactionCallback).toBeNull();
    lateCallback?.();
    expect(onAction).not.toHaveBeenCalled();
  });

  it('keeps only the last selected action when multiple actions are tapped before close applies', () => {
    const onAction = vi.fn();
    const onClose = vi.fn();

    const { rerender } = render(
      <DomainOptionsSheet
        visible
        domain={baseDomain}
        onClose={onClose}
        onAction={onAction}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Visit Site' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Domain' }));
    expect(onClose).toHaveBeenCalledTimes(2);

    rerender(
      <DomainOptionsSheet
        visible={false}
        domain={baseDomain}
        onClose={onClose}
        onAction={onAction}
      />
    );

    mocks.interactionCallback?.();
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith('delete', baseDomain);
  });

  it('clears stale pending actions when the sheet is reopened', () => {
    const onAction = vi.fn();
    const onClose = vi.fn();

    const { rerender } = render(
      <DomainOptionsSheet
        visible
        domain={baseDomain}
        onClose={onClose}
        onAction={onAction}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Visit Site' }));

    rerender(
      <DomainOptionsSheet
        visible={false}
        domain={baseDomain}
        onClose={onClose}
        onAction={onAction}
      />
    );

    rerender(
      <DomainOptionsSheet
        visible
        domain={baseDomain}
        onClose={onClose}
        onAction={onAction}
      />
    );

    rerender(
      <DomainOptionsSheet
        visible={false}
        domain={baseDomain}
        onClose={onClose}
        onAction={onAction}
      />
    );

    expect(mocks.interactionCallback).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });
});
