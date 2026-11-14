import React from 'react';

// The minimal react-native surface OrderDetailsScreenContent renders, as DOM
// elements that keep the accessibility props the tests query.
export function reactNativeMock() {
  return {
    StatusBar: () => null,
    Pressable: ({
      accessibilityLabel,
      accessibilityRole,
      children,
      onPress,
    }: {
      accessibilityLabel?: string;
      accessibilityRole?: string;
      children?: React.ReactNode;
      onPress?: () => void;
    }) =>
      React.createElement(
        'div',
        {
          'aria-label': accessibilityLabel,
          onClick: () => onPress?.(),
          role: accessibilityRole,
        },
        children
      ),
    ScrollView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
    View: ({
      accessibilityElementsHidden,
      children,
      importantForAccessibility,
      testID,
    }: {
      accessibilityElementsHidden?: boolean;
      children?: React.ReactNode;
      importantForAccessibility?: string;
      testID?: string;
    }) =>
      React.createElement(
        'div',
        {
          'data-accessibility-elements-hidden': String(
            Boolean(accessibilityElementsHidden)
          ),
          'data-important-for-accessibility': importantForAccessibility,
          'data-testid': testID,
        },
        children
      ),
  };
}
