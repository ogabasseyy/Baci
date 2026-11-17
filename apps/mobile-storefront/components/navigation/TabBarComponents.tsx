import Ionicons from '@react-native-vector-icons/ionicons';
import type React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { ZoomIn, ZoomOut } from 'react-native-reanimated';
import { useTheme } from '@/hooks/useTheme';
import { CONFIG } from '@/lib/config';

type TabIconName = React.ComponentProps<typeof Ionicons>['name'];

const FILLED_TAB_ICONS: Partial<Record<TabIconName, TabIconName>> = {
  'home-outline': 'home',
  'heart-outline': 'heart',
  'cart-outline': 'cart',
  'wallet-outline': 'wallet',
  'person-outline': 'person',
};

export function TabBarLabel({
  focused,
  label,
  activeColor,
}: {
  focused: boolean;
  label: string;
  activeColor?: string;
}) {
  const { colors } = useTheme();

  // Test requirement: must return null when not focused to keep routing expectations clean
  if (!focused) return null;

  return (
    <Animated.Text
      style={[
        styles.tabLabel,
        { color: activeColor ?? colors.tabIconSelected },
      ]}
    >
      {label}
    </Animated.Text>
  );
}

export function TabBarIcon({
  name,
  focused,
  badge,
  activeColor,
}: {
  name: TabIconName;
  focused: boolean;
  badge?: number;
  activeColor?: string;
}) {
  const { colors, isDark } = useTheme();
  const branded = CONFIG.MERCHANT_SLUG === 'ogabassey';
  const useWhiteFill = branded && isDark;
  const iconName = useWhiteFill ? (FILLED_TAB_ICONS[name] ?? name) : name;
  const inactiveColor = branded
    ? isDark
      ? '#fff'
      : '#685962'
    : colors.tabIconDefault;

  return (
    <View style={styles.iconContainer}>
      <Animated.View testID="tab-bar-icon-inner" style={styles.iconInner}>
        <Ionicons
          name={iconName}
          size={22}
          color={
            focused && !useWhiteFill
              ? (activeColor ?? colors.tabIconSelected)
              : inactiveColor
          }
          style={{ opacity: focused || branded ? 1 : 0.6 }}
        />
        {badge !== undefined && badge > 0 && (
          <Animated.View
            entering={ZoomIn.springify().damping(12)}
            exiting={ZoomOut}
            style={[
              styles.badge,
              {
                backgroundColor: colors.primary,
                borderColor: colors.card,
              },
            ]}
          >
            <Animated.Text
              style={[styles.badgeText, { color: colors.primaryForeground }]}
            >
              {badge > 99 ? '99+' : badge}
            </Animated.Text>
          </Animated.View>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  iconContainer: {
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconInner: {
    width: 44,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: 4,
    borderRadius: 9,
    minWidth: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 2,
    borderWidth: 1.5,
  },
  badgeText: {
    fontSize: 8,
    fontWeight: '800',
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    marginTop: 4,
  },
});
