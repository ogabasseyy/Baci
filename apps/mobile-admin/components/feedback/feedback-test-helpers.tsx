import type React from 'react';
import { vi } from 'vitest';

export const themeTextOnPrimary = '#991122';

export type StyleInput =
  | React.CSSProperties
  | readonly StyleInput[]
  | null
  | undefined
  | false;

export type NativeProps = {
  accessibilityLabel?: string;
  accessibilityRole?: string;
  accessibilityState?: { disabled?: boolean; selected?: boolean };
  children?: React.ReactNode;
  disabled?: boolean;
  onPress?: () => void;
  style?: StyleInput;
  testID?: string;
};

export function isStyleList(style: StyleInput): style is readonly StyleInput[] {
  return Array.isArray(style);
}

export function flattenStyle(style: StyleInput): React.CSSProperties {
  if (!style) return {};
  if (isStyleList(style)) {
    const merged: React.CSSProperties = {};
    for (const item of style) {
      Object.assign(merged, flattenStyle(item));
    }
    return merged;
  }

  return style;
}

export const MockActivityIndicator = ({ color }: { color?: string }) => (
  <div data-color={color} data-testid="activity-indicator" />
);

export const MockPressable = ({
  accessibilityLabel,
  accessibilityRole,
  accessibilityState,
  children,
  disabled,
  onPress,
  style,
  testID,
}: NativeProps) => {
  const isDisabled = Boolean(disabled || accessibilityState?.disabled);
  const flattenedStyle = flattenStyle(style);
  return (
    <button
      aria-disabled={isDisabled}
      aria-label={accessibilityLabel}
      aria-pressed={accessibilityState?.selected}
      data-border-color={flattenedStyle.borderColor}
      data-opacity={flattenedStyle.opacity}
      data-selected={accessibilityState?.selected ? 'true' : undefined}
      data-testid={testID}
      disabled={isDisabled}
      onClick={isDisabled ? undefined : onPress}
      role={accessibilityRole}
      style={flattenedStyle}
      type="button"
    >
      {children}
    </button>
  );
};

export const MockScrollView = ({ children, style }: NativeProps) => (
  <div style={flattenStyle(style)}>{children}</div>
);

export const MockStatusBar = () => null;

export const MockStyleSheet = {
  create: <T,>(styles: T): T => styles,
};

export const MockText = ({ children, style }: NativeProps) => {
  const flattenedStyle = flattenStyle(style);
  return (
    <span data-style-color={flattenedStyle.color} style={flattenedStyle}>
      {children}
    </span>
  );
};

export const MockTextInput = ({
  onChangeText,
  placeholder,
  value,
}: {
  onChangeText?: (text: string) => void;
  placeholder?: string;
  value?: string;
}) => (
  <textarea
    onChange={(e) => onChangeText?.(e.target.value)}
    placeholder={placeholder}
    value={value}
  />
);

export const MockView = ({ children, style }: NativeProps) => (
  <div style={flattenStyle(style)}>{children}</div>
);

export function createFeedbackReactNativeMock(
  overrides?: Record<string, unknown>
) {
  return {
    ActivityIndicator: MockActivityIndicator,
    Alert: { alert: vi.fn() },
    Pressable: MockPressable,
    ScrollView: MockScrollView,
    StatusBar: MockStatusBar,
    StyleSheet: MockStyleSheet,
    Text: MockText,
    TextInput: MockTextInput,
    View: MockView,
    ...overrides,
  };
}
