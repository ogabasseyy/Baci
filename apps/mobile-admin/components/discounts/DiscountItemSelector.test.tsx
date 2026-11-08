import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiscountItemSelector } from './DiscountItemSelector';

const mocks = vi.hoisted(() => ({
  fetchSelectableItems: vi.fn(),
  keyboardContainerProps: {
    align: undefined as 'start' | 'center' | 'end' | undefined,
    scrollEnabled: undefined as boolean | undefined,
  },
  listProps: {
    initialNumToRender: 0,
    maxToRenderPerBatch: 0,
    removeClippedSubviews: false,
    windowSize: 0,
  },
  platform: { OS: 'ios' as 'ios' | 'android' },
}));

vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({
    merchant: { id: 'merchant-1' },
  }),
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#ffffff',
      backgroundLight: '#f8fafc',
      border: '#e2e8f0',
      error: '#dc2626',
      errorLight: '#fee2e2',
      inputBg: '#f1f5f9',
      primary: '#2563eb',
      text: '#0f172a',
      textMuted: '#64748b',
    },
  }),
}));

vi.mock('@/lib/discount-items', () => ({
  fetchSelectableItems: mocks.fetchSelectableItems,
}));

vi.mock('@/components/ui/SafeImage', async () => {
  const { Text } = await import('react-native');
  return {
    default: () => <Text>image</Text>,
  };
});

vi.mock('@/components/ui/AppKeyboardContainer', () => ({
  AppKeyboardContainer: ({
    align,
    children,
    scrollEnabled,
  }: {
    align?: 'start' | 'center' | 'end';
    children?: ReactNode;
    scrollEnabled?: boolean;
  }) => {
    mocks.keyboardContainerProps.align = align;
    mocks.keyboardContainerProps.scrollEnabled = scrollEnabled;
    return (
      <section aria-label="discount-keyboard-container">{children}</section>
    );
  },
}));

vi.mock('@react-native-vector-icons/ionicons', async () => {
  const { Text } = await import('react-native');
  return {
    Ionicons: () => <Text>icon</Text>,

    default: () => <Text>icon</Text>,
    __esModule: true,
  };
});

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children?: ReactNode }) => (
    <section aria-label="discount-safe-area-provider">{children}</section>
  ),
  SafeAreaView: ({ children }: { children?: ReactNode }) => (
    <section>{children}</section>
  ),
}));

vi.mock('react-native', () => {
  const Text = ({ children }: { children?: ReactNode }) => (
    <span>{children}</span>
  );

  return {
    StatusBar: () => null,
    ActivityIndicator: () => <Text>loading</Text>,
    FlatList: ({
      data,
      initialNumToRender,
      maxToRenderPerBatch,
      removeClippedSubviews,
      renderItem,
      windowSize,
    }: {
      data: Array<{ id: string; name: string }>;
      initialNumToRender?: number;
      maxToRenderPerBatch?: number;
      removeClippedSubviews?: boolean;
      renderItem: (props: { item: { id: string; name: string } }) => ReactNode;
      windowSize?: number;
    }) => {
      mocks.listProps.initialNumToRender = initialNumToRender ?? 0;
      mocks.listProps.maxToRenderPerBatch = maxToRenderPerBatch ?? 0;
      mocks.listProps.removeClippedSubviews = removeClippedSubviews ?? false;
      mocks.listProps.windowSize = windowSize ?? 0;
      return <div>{data.map((item) => renderItem({ item }))}</div>;
    },
    Modal: ({
      children,
      visible,
    }: {
      children?: ReactNode;
      visible?: boolean;
    }) => (visible ? <div>{children}</div> : null),
    Platform: mocks.platform,
    Pressable: ({
      accessibilityLabel,
      children,
      onPress,
    }: {
      accessibilityLabel?: string;
      children?: ReactNode;
      onPress?: () => void;
    }) => (
      <button
        aria-label={accessibilityLabel}
        onClick={() => onPress?.()}
        type="button"
      >
        {children}
      </button>
    ),
    SafeAreaView: ({ children }: { children?: ReactNode }) => (
      <section>{children}</section>
    ),
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
    },
    Text,
    TextInput: ({
      onChangeText,
      placeholder,
      value,
    }: {
      onChangeText?: (value: string) => void;
      placeholder?: string;
      value?: string;
    }) => (
      <input
        onChange={(event) => onChangeText?.(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    ),
    View: ({
      children,
      accessibilityLiveRegion,
      accessibilityRole,
    }: {
      children?: ReactNode;
      accessibilityLiveRegion?: 'assertive' | 'none' | 'polite';
      accessibilityRole?: string;
    }) => (
      <div
        aria-live={
          accessibilityLiveRegion === 'none' ? 'off' : accessibilityLiveRegion
        }
        role={accessibilityRole}
      >
        {children}
      </div>
    ),
  };
});

describe('DiscountItemSelector', () => {
  beforeEach(() => {
    mocks.fetchSelectableItems.mockReset();
    mocks.fetchSelectableItems.mockResolvedValue([
      {
        id: 'product-1',
        name: 'First Product',
        images: [],
      },
    ]);
    mocks.keyboardContainerProps.align = undefined;
    mocks.keyboardContainerProps.scrollEnabled = undefined;
    mocks.listProps.initialNumToRender = 0;
    mocks.listProps.maxToRenderPerBatch = 0;
    mocks.listProps.removeClippedSubviews = false;
    mocks.listProps.windowSize = 0;
  });

  afterEach(() => {
    mocks.platform.OS = 'ios';
  });

  it('renders search and done controls', async () => {
    render(
      <DiscountItemSelector
        initialIds={[]}
        onClose={vi.fn()}
        onSelect={vi.fn()}
        type="product"
        visible={true}
      />
    );

    expect(screen.getByLabelText('Done')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('First Product')).toBeInTheDocument();
    });
  });

  it('uses the shared keyboard container with non-scroll shell settings', () => {
    render(
      <DiscountItemSelector
        initialIds={[]}
        onClose={vi.fn()}
        onSelect={vi.fn()}
        type="category"
        visible={true}
      />
    );

    expect(
      screen.getByLabelText('discount-keyboard-container')
    ).toBeInTheDocument();
    expect(mocks.keyboardContainerProps.align).toBe('start');
    expect(mocks.keyboardContainerProps.scrollEnabled).toBe(false);
    expect(mocks.listProps.initialNumToRender).toBe(15);
    expect(mocks.listProps.maxToRenderPerBatch).toBe(10);
    expect(mocks.listProps.windowSize).toBe(5);
    expect(mocks.listProps.removeClippedSubviews).toBe(false);
  });

  it('creates a safe-area provider inside the modal root', () => {
    render(
      <DiscountItemSelector
        initialIds={[]}
        onClose={vi.fn()}
        onSelect={vi.fn()}
        type="product"
        visible={true}
      />
    );

    expect(
      screen.getByLabelText('discount-safe-area-provider')
    ).toBeInTheDocument();
  });

  it('enables clipped subviews for Android via shared list props', () => {
    mocks.platform.OS = 'android';

    render(
      <DiscountItemSelector
        initialIds={[]}
        onClose={vi.fn()}
        onSelect={vi.fn()}
        type="product"
        visible={true}
      />
    );

    expect(mocks.listProps.removeClippedSubviews).toBe(true);
  });

  it('renders error feedback when selectable items fetch fails', async () => {
    mocks.fetchSelectableItems.mockRejectedValue(new Error('fetch failed'));

    render(
      <DiscountItemSelector
        initialIds={[]}
        onClose={vi.fn()}
        onSelect={vi.fn()}
        type="product"
        visible={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Failed to load items')).toBeInTheDocument();
      const alertElement = screen.getByRole('alert');
      expect(alertElement).toBeInTheDocument();
      expect(alertElement).toHaveAttribute('aria-live', 'assertive');
    });
  });
});
