import type {
  TextProps as NativeTextProps,
  ViewProps as NativeViewProps,
} from 'react-native';
/**
 * Learn more about Light and Dark modes:
 * https://docs.expo.io/guides/color-schemes/
 *
 * 2026 Best Practice: Font Scaling Accessibility
 * - allowFontScaling defaults to true to respect system accessibility settings
 * - maxFontSizeMultiplier prevents extreme scaling that breaks layouts
 * - Users can override with allowFontScaling={false} for specific cases (e.g., badges)
 */

import { Text as DefaultText, View as DefaultView } from 'react-native';

import Colors from '@/constants/Colors';
import { useColorScheme } from './useColorScheme';

/**
 * Default max font size multiplier to prevent extreme scaling
 * that could break layouts while still supporting accessibility
 */
const DEFAULT_MAX_FONT_SIZE_MULTIPLIER = 1.5;

type ThemeProps = {
  lightColor?: string;
  darkColor?: string;
};

export type TextProps = ThemeProps & NativeTextProps;
export type ViewProps = ThemeProps & NativeViewProps;

function useThemeColor(
  props: { light?: string; dark?: string },
  colorName: keyof typeof Colors.light & keyof typeof Colors.dark
) {
  const scheme = useColorScheme();
  const theme = scheme === 'dark' ? 'dark' : 'light';
  const colorFromProps = props[theme];

  if (colorFromProps) {
    return colorFromProps;
  } else {
    return Colors[theme][colorName];
  }
}

export function Text(props: TextProps) {
  const {
    style,
    lightColor,
    darkColor,
    allowFontScaling = true,
    maxFontSizeMultiplier = DEFAULT_MAX_FONT_SIZE_MULTIPLIER,
    ...otherProps
  } = props;
  const color = useThemeColor({ light: lightColor, dark: darkColor }, 'text');

  return (
    <DefaultText
      style={[{ color }, style]}
      allowFontScaling={allowFontScaling}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      {...otherProps}
    />
  );
}

export function View(props: ViewProps) {
  const { style, lightColor, darkColor, ...otherProps } = props;
  const backgroundColor = useThemeColor(
    { light: lightColor, dark: darkColor },
    'background'
  );

  return <DefaultView style={[{ backgroundColor }, style]} {...otherProps} />;
}
