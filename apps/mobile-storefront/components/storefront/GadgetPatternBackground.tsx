import { StyleSheet, View } from 'react-native';
import { BRAND } from '@/constants/Colors';
import { GadgetPattern } from './GadgetPattern';

interface GadgetPatternBackgroundProps {
  colorScheme: 'light' | 'dark';
  backgroundColor: string;
  height?: number;
  opacity?: number;
}

export const PATTERN_HEIGHT = 1500;
export const DARK_OPACITY = 0.04;
export const LIGHT_OPACITY = 0.07;
export const DARK_COLOR = BRAND.primary;
export const LIGHT_COLOR = BRAND.primary;

export function GadgetPatternBackground({
  colorScheme,
  backgroundColor,
  height = PATTERN_HEIGHT,
  opacity,
}: GadgetPatternBackgroundProps) {
  const isDark = colorScheme === 'dark';
  const patternOpacity = opacity ?? (isDark ? DARK_OPACITY : LIGHT_OPACITY);
  const patternColor = isDark ? DARK_COLOR : LIGHT_COLOR;

  return (
    <>
      {/* Base background color layer to ensure reliable absolute rendering */}
      <View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor, pointerEvents: 'none' },
        ]}
      />

      {/* Absolute background gadget pattern for premium tech framing */}
      <View
        style={[
          StyleSheet.absoluteFill,
          { overflow: 'hidden', pointerEvents: 'none' },
        ]}
      >
        <GadgetPattern
          colorScheme={colorScheme}
          opacity={patternOpacity}
          height={height}
          color={patternColor}
        />
      </View>
    </>
  );
}
