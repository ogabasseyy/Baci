import type { ReactNode } from 'react';
import { vi } from 'vitest';

vi.mock('expo-router', () => ({
  router: { push: vi.fn() },
}));

vi.mock('@react-native-vector-icons/ionicons', () => ({
  default: () => null,
  __esModule: true,
}));

vi.mock('@/components/orders/NewOrderProductPickerSheetFrame', () => ({
  NewOrderProductPickerSheetFrame: ({
    children,
    closeLabel,
    footer,
    leadingAccessory,
    onClose,
    title,
    trailingAccessory,
    visible,
  }: {
    children?: ReactNode;
    closeLabel: string;
    footer?: ReactNode;
    leadingAccessory?: ReactNode;
    onClose: () => void;
    title: string;
    trailingAccessory?: ReactNode;
    visible: boolean;
  }) =>
    visible ? (
      <section aria-label="product-page-sheet">
        <div data-testid="product-sheet-leading-accessory">
          {leadingAccessory ?? (
            <button aria-label={closeLabel} onClick={onClose} type="button" />
          )}
        </div>
        <h1>{title}</h1>
        <div data-testid="product-sheet-trailing-accessory">
          {trailingAccessory}
        </div>
        {children}
        {footer}
      </section>
    ) : null,
}));

vi.mock('./NewOrderProductSheetEmptyState', () => ({
  NewOrderProductSheetEmptyState: () => <div role="status">empty</div>,
}));

vi.mock('@gorhom/bottom-sheet', async () => {
  const React = await import('react');

  return {
    BottomSheetFlatList: ({
      ListEmptyComponent,
      ListFooterComponent,
      data,
      onEndReached,
      renderItem,
    }: {
      ListEmptyComponent?: ReactNode;
      ListFooterComponent?: ReactNode;
      data: unknown[];
      onEndReached?: () => void;
      renderItem: (item: { item: unknown }) => ReactNode;
    }) =>
      React.createElement(
        'div',
        null,
        data.length === 0
          ? ListEmptyComponent
          : data.map((item, index) =>
              React.createElement(
                'div',
                { key: String(index) },
                renderItem({ item })
              )
            ),
        ListFooterComponent,
        React.createElement(
          'button',
          {
            'aria-label': 'Reach list end',
            onClick: () => onEndReached?.(),
            type: 'button',
          },
          'Reach list end'
        )
      ),
    BottomSheetScrollView: ({
      children,
      testID,
    }: {
      children?: ReactNode;
      testID?: string;
    }) => React.createElement('div', { 'data-testid': testID }, children),
    BottomSheetTextInput: () => null,
  };
});

vi.mock('react-native', async () => {
  const React = await import('react');

  return {
    useColorScheme: () => 'light',
    StatusBar: () => null,
    ActivityIndicator: () =>
      React.createElement('div', { role: 'progressbar' }, 'loading'),
    Platform: {
      OS: 'ios',
      select: (objs: Record<string, unknown>) => objs.ios || objs.default,
    },
    InteractionManager: {
      runAfterInteractions: (callback: () => void) => {
        callback();
        return { cancel: vi.fn() };
      },
    },
    Pressable: ({
      accessibilityLabel,
      accessibilityState,
      children,
      disabled,
      onPress,
    }: {
      accessibilityLabel?: string;
      accessibilityState?: { disabled?: boolean; selected?: boolean };
      children?: ReactNode;
      disabled?: boolean;
      onPress?: () => void;
    }) =>
      React.createElement(
        'button',
        {
          'aria-disabled': disabled || accessibilityState?.disabled,
          'aria-label': accessibilityLabel,
          'aria-pressed': accessibilityState?.selected,
          disabled,
          onClick: () => {
            if (!(disabled || accessibilityState?.disabled)) {
              onPress?.();
            }
          },
          type: 'button',
        },
        children
      ),
    ScrollView: ({ children }: { children?: ReactNode }) =>
      React.createElement('div', null, children),
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
    },
    Text: ({ children }: { children?: ReactNode }) =>
      React.createElement('span', null, children),
    View: ({ children }: { children?: ReactNode }) =>
      React.createElement('div', null, children),
  };
});
