import type { ReactNode } from 'react';

interface MockProps {
  platform: { OS: 'ios' | 'android' };
  listProps: {
    initialNumToRender: number;
    maxToRenderPerBatch: number;
    removeClippedSubviews: boolean;
    windowSize: number;
  };
  announceForAccessibility: (message: string) => void;
}

export function createDiscountItemSelectorReactNativeMock(mocks: MockProps) {
  const Text = ({ children }: { children?: ReactNode }) => (
    <span>{children}</span>
  );

  return {
    AccessibilityInfo: {
      announceForAccessibility: (message: string) => {
        mocks.announceForAccessibility(message);
      },
    },
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
    StatusBar: () => null,
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
}
