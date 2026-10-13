import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { BRAND } from '@/constants/Colors';
import { GadgetPattern } from './GadgetPattern';

const DARK_PATTERN_COLOR = '#ffffff';
const DARK_PATTERN_OPACITY = 0.04;
const LIGHT_PATTERN_OPACITY = 0.07;

interface PatternedBackgroundProps {
  backgroundColor: string;
  isDark: boolean;
}

export function PatternedBackground({
  backgroundColor,
  isDark,
}: PatternedBackgroundProps) {
  const [patternHeight, setPatternHeight] = useState(0);

  return (
    <>
      <View
        style={[StyleSheet.absoluteFill, { backgroundColor }]}
        testID="patterned-background-base"
      />
      <View
        onLayout={(event) => setPatternHeight(event.nativeEvent.layout.height)}
        style={[StyleSheet.absoluteFill, styles.patternClip]}
        testID="patterned-background-clip"
      >
        <GadgetPattern
          colorScheme={isDark ? 'dark' : 'light'}
          opacity={isDark ? DARK_PATTERN_OPACITY : LIGHT_PATTERN_OPACITY}
          height={patternHeight}
          color={isDark ? DARK_PATTERN_COLOR : BRAND.primary}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  patternClip: {
    overflow: 'hidden',
  },
});
