import { LinearGradient } from 'expo-linear-gradient';
import { Image, StyleSheet, useColorScheme, View } from 'react-native';
import { useGadgetPatternAttribution } from './use-gadget-pattern-attribution';

interface GadgetPatternProps {
  color?: string;
  colorScheme?: 'light' | 'dark';
  height?: number;
  opacity?: number;
  variant?: 'default' | 'tabbar';
}

const ACCENT_SOURCE = require('../../assets/images/tech-backdrop-accent.png');
const DARK_GRADIENT = [
  'rgba(255,255,255,1)',
  'rgba(255,255,255,0.24)',
  'rgba(255,255,255,0)',
] as const;
const LIGHT_GRADIENT = [
  'rgba(15,23,42,1)',
  'rgba(15,23,42,0.22)',
  'rgba(15,23,42,0)',
] as const;

/**
 * Lightweight replacement for the repeated SVG tree implicated in Android ANRs.
 * It keeps the technology motif while limiting each surface to one gradient and
 * one downsampled raster accent.
 */
export function GadgetPattern({
  color,
  colorScheme,
  height = 260,
  opacity = 0.05,
  variant = 'default',
}: GadgetPatternProps) {
  const activeColorScheme = useColorScheme();
  const resolvedColorScheme = colorScheme ?? activeColorScheme;
  const isDark = resolvedColorScheme === 'dark';
  const accentColor = color ?? (isDark ? '#ffffff' : '#0f172a');

  useGadgetPatternAttribution(true, variant);

  return (
    <View
      style={[styles.container, { height, pointerEvents: 'none' }]}
      testID="tech-backdrop"
    >
      <LinearGradient
        colors={isDark ? DARK_GRADIENT : LIGHT_GRADIENT}
        end={{ x: 0, y: 1 }}
        start={{ x: 1, y: 0 }}
        style={[StyleSheet.absoluteFill, { opacity }]}
        testID="tech-backdrop-gradient"
      />
      <Image
        accessibilityIgnoresInvertColors
        resizeMethod="resize"
        resizeMode="contain"
        source={ACCENT_SOURCE}
        style={[
          styles.accent,
          variant === 'tabbar' ? styles.tabbarAccent : styles.defaultAccent,
          { opacity, tintColor: accentColor },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  accent: {
    position: 'absolute',
    right: 0,
    top: 0,
  },
  container: {
    overflow: 'hidden',
    width: '100%',
  },
  defaultAccent: {
    height: 300,
    width: 300,
  },
  tabbarAccent: {
    height: 96,
    width: 180,
  },
});
