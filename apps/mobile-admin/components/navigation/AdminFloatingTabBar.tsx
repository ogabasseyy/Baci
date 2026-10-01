import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useEffect, useRef } from 'react';
import {
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { triggerLightHaptic } from '@/components/ui/haptics';
import { useTheme } from '@/hooks/useTheme';
import { recordAdminTabPress } from '@/lib/admin-tab-double-tap';
import { scrollAdminTabToTop } from '@/lib/admin-tab-scroll-to-top';
import { withHexAlpha } from './AdminFloatingTabBar.colors';
import { PRIMARY_ADMIN_TAB_ROUTE_NAMES } from './AdminFloatingTabBar.routes';
import type { AdminFloatingTabOptions } from './AdminFloatingTabBarItem';
import { AdminFloatingTabBarItem } from './AdminFloatingTabBarItem';
import { animateAdminFloatingTabIndicator } from './AdminFloatingTabBarLiquidIndicator';
import { createJumpToTabAction } from './create-jump-to-tab-action';
import { useWarmAdminTabScreens } from './useWarmAdminTabScreens';

const BAR_HORIZONTAL_MARGIN = 12;
const BAR_HORIZONTAL_PADDING = 8;
const BAR_HEIGHT = 62;
const CAPSULE_WIDTH = 42;
const CAPSULE_HEIGHT = 38;

export function AdminFloatingTabBar({
  descriptors,
  navigation,
  state,
}: BottomTabBarProps) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const activeRouteName = state.routes[state.index]?.name ?? 'index';

  const visibleRoutes = state.routes.filter((route) => {
    const descriptor = descriptors[route.key] as unknown as {
      options: AdminFloatingTabOptions;
    };
    return (
      PRIMARY_ADMIN_TAB_ROUTE_NAMES.has(route.name) &&
      descriptor.options.href !== null
    );
  });

  const visibleRouteCount = Math.max(visibleRoutes.length, 1);
  const barContentWidth =
    width - BAR_HORIZONTAL_MARGIN * 2 - BAR_HORIZONTAL_PADDING * 2;
  const tabWidth = barContentWidth / visibleRouteCount;
  const activeIndex = visibleRoutes.findIndex(
    (route) => route.name === activeRouteName
  );
  const targetIndexValue = activeIndex === -1 ? 0 : activeIndex;

  const animIndex = useSharedValue(targetIndexValue);
  const targetIndex = useSharedValue(targetIndexValue);
  const capsuleScale = useSharedValue(1);
  const lastTargetIndexRef = useRef(targetIndexValue);
  const confirmedRouteIndexRef = useRef(targetIndexValue);
  const pressInHandledRouteKeyRef = useRef<string | null>(null);
  const lastFocusedPressRef = useRef({ at: 0, routeKey: '' });
  const bottomInset = insets.bottom > 0 ? insets.bottom : 10;
  const capsuleBackgroundColor = isDark
    ? colors.primaryLight
    : colors.goldLight;
  const capsuleBorderColor = withHexAlpha(
    isDark ? colors.primary : colors.gold,
    0.32
  );

  useWarmAdminTabScreens({
    activeRouteName,
    navigation,
    routes: visibleRoutes,
  });

  useEffect(() => {
    if (targetIndexValue === confirmedRouteIndexRef.current) {
      return;
    }

    confirmedRouteIndexRef.current = targetIndexValue;
    animateAdminFloatingTabIndicator(
      targetIndexValue,
      lastTargetIndexRef,
      targetIndex,
      animIndex,
      capsuleScale
    );
  }, [animIndex, capsuleScale, targetIndex, targetIndexValue]);

  const capsuleStyle = useAnimatedStyle(() => {
    const currentPosition = animIndex.value;
    const distance = Math.abs(targetIndex.value - currentPosition);
    const stretchX = 1 + Math.min(distance * 0.32, 0.24);
    const shrinkY = 1 - Math.min(distance * 0.1, 0.08);
    const centerOffset = (tabWidth - CAPSULE_WIDTH) / 2;
    const translateX =
      BAR_HORIZONTAL_PADDING + currentPosition * tabWidth + centerOffset;

    return {
      backgroundColor: capsuleBackgroundColor,
      borderColor: capsuleBorderColor,
      borderRadius: CAPSULE_WIDTH / 2,
      borderWidth: 1,
      height: CAPSULE_HEIGHT,
      position: 'absolute',
      top: 5,
      transform: [
        { translateX },
        { scaleX: stretchX * capsuleScale.value },
        { scaleY: shrinkY * capsuleScale.value },
      ] as ViewStyle['transform'],
      width: CAPSULE_WIDTH,
      zIndex: 1,
    };
  });

  return (
    <View
      accessibilityRole="tablist"
      pointerEvents="box-none"
      style={[
        styles.outer,
        {
          height: BAR_HEIGHT + bottomInset + 16,
          paddingBottom: bottomInset + 8,
        },
      ]}
      testID="admin-floating-tab-bar-wrapper"
    >
      <View
        style={[
          styles.bar,
          {
            backgroundColor: isDark
              ? 'rgba(26, 26, 46, 0.88)'
              : 'rgba(255, 255, 255, 0.9)',
            borderColor: isDark
              ? 'rgba(255, 255, 255, 0.13)'
              : 'rgba(15, 23, 42, 0.1)',
            shadowColor: isDark ? '#000000' : colors.primary,
          },
        ]}
        testID="admin-floating-tab-bar"
      >
        <Animated.View
          pointerEvents="none"
          style={capsuleStyle}
          testID="admin-floating-tab-capsule"
        />

        {visibleRoutes.map((route, index) => {
          const { options } = descriptors[route.key] as unknown as {
            options: AdminFloatingTabOptions;
          };
          const isFocused = route.name === activeRouteName;
          const label = options.title ?? route.name;

          const commitTabSelection = (shouldAnimateIndicator: boolean) => {
            if (shouldAnimateIndicator && !isFocused) {
              animateAdminFloatingTabIndicator(
                index,
                lastTargetIndexRef,
                targetIndex,
                animIndex,
                capsuleScale
              );

              triggerLightHaptic();
            }

            const event = navigation.emit({
              canPreventDefault: true,
              target: route.key,
              type: 'tabPress',
            });

            if (event.defaultPrevented) {
              animateAdminFloatingTabIndicator(
                targetIndexValue,
                lastTargetIndexRef,
                targetIndex,
                animIndex,
                capsuleScale
              );
              return;
            }

            if (!isFocused) {
              navigation.dispatch({
                ...createJumpToTabAction(route.name, route.params),
                target: state.key,
              });
            }
          };

          const handlePressIn = () => {
            if (!isFocused) {
              commitTabSelection(true);
              pressInHandledRouteKeyRef.current = route.key;
            }
          };

          const handlePress = () => {
            if (pressInHandledRouteKeyRef.current === route.key) {
              pressInHandledRouteKeyRef.current = null;
              // Count pressIn selection as first double-tap press.
              lastFocusedPressRef.current = recordAdminTabPress(
                lastFocusedPressRef.current,
                route.key,
                Date.now()
              ).nextPress;
              return;
            }

            commitTabSelection(!isFocused);
            if (!isFocused) return;

            const press = recordAdminTabPress(
              lastFocusedPressRef.current,
              route.key,
              Date.now()
            );
            lastFocusedPressRef.current = press.nextPress;
            if (press.isDoubleTap) {
              scrollAdminTabToTop(route.name);
            }
          };

          const handlePressOut = () => {
            globalThis.setTimeout(() => {
              if (pressInHandledRouteKeyRef.current === route.key) {
                pressInHandledRouteKeyRef.current = null;
              }
            }, 0);
          };

          return (
            <AdminFloatingTabBarItem
              badge={options.tabBarBadge}
              colors={colors}
              isFocused={isFocused}
              key={route.key}
              label={label}
              onPress={handlePress}
              onPressIn={handlePressIn}
              onPressOut={handlePressOut}
              options={options}
              routeName={route.name}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    backgroundColor: 'transparent',
    bottom: 0,
    justifyContent: 'flex-end',
    left: 0,
    paddingHorizontal: BAR_HORIZONTAL_MARGIN,
    position: 'absolute',
    right: 0,
    width: '100%',
    zIndex: 100,
  },
  bar: {
    alignItems: 'center',
    borderRadius: 31,
    borderWidth: 1,
    flexDirection: 'row',
    height: BAR_HEIGHT,
    justifyContent: 'space-between',
    overflow: 'hidden',
    paddingHorizontal: BAR_HORIZONTAL_PADDING,
    position: 'relative',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
    elevation: 8,
  },
});
