import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { TabActions } from 'expo-router/react-navigation';
import { useEffect, useRef, useState } from 'react';
import {
  Platform,
  StyleSheet,
  UIManager,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { getTabBarShadowStyle } from '@/components/navigation/TabBar.shadows';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { BRAND } from '@/constants/Colors';
import { CustomTabBarItem, type CustomTabOptions } from './CustomTabBarItem';
import { useWarmTabScreens } from './useWarmTabScreens';
import { WalletDiscoveryBubble } from './WalletDiscoveryBubble';

const HAS_EXPO_BLUR = UIManager.hasViewManagerConfig('ExpoBlurView');
const BlurContainer = HAS_EXPO_BLUR ? BlurView : View;
const CAPSULE_WIDTH = 36;
const CAPSULE_HEIGHT = 36;
const MOVE_SPRING = { damping: 11, stiffness: 145, mass: 0.8 };
const SCALE_REST_SPRING = { damping: 12, stiffness: 140 };
const SCALE_PULSE_SPRING = { damping: 9, stiffness: 220 };

export function CustomTabBarChrome({
  state,
  descriptors,
  navigation,
  activeRouteName,
  preloadProtectedTabs,
}: BottomTabBarProps & {
  activeRouteName: string;
  preloadProtectedTabs: boolean;
}) {
  const { width: screenWidth } = useWindowDimensions();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const visibleRoutes = state.routes.filter((route) => {
    const { options } = descriptors[route.key] as unknown as {
      options: CustomTabOptions;
    };
    return options.href !== null && route.name !== 'categories';
  });

  const tabBarContentWidth = Math.max(screenWidth - 48, visibleRoutes.length);
  const tabWidth =
    visibleRoutes.length > 0 ? tabBarContentWidth / visibleRoutes.length : 0;
  const activeIdx = visibleRoutes.findIndex((r) => r.name === activeRouteName);
  const walletIdx = visibleRoutes.findIndex((route) => route.name === 'wallet');
  const safeActiveIdx = activeIdx !== -1 ? activeIdx : 0;
  const pressInHandledRouteKeyRef = useRef<string | null>(null);
  const [optimisticRouteName, setOptimisticRouteName] =
    useState(activeRouteName);
  const [prevActiveRouteName, setPrevActiveRouteName] =
    useState(activeRouteName);
  const animIndex = useSharedValue(safeActiveIdx);
  const targetIndex = useSharedValue(safeActiveIdx);
  const capsuleScale = useSharedValue(1);

  // Sync the optimistic selection back to the real route during render
  // (guarded prev-prop compare) instead of via a setState-in-effect.
  if (activeRouteName !== prevActiveRouteName) {
    setPrevActiveRouteName(activeRouteName);
    setOptimisticRouteName(activeRouteName);
  }

  useEffect(() => {
    if (safeActiveIdx === targetIndex.get()) {
      return;
    }

    targetIndex.set(safeActiveIdx);
    animIndex.set(withSpring(safeActiveIdx, MOVE_SPRING));
    capsuleScale.set(withSpring(1, SCALE_REST_SPRING));
  }, [animIndex, capsuleScale, safeActiveIdx, targetIndex]);

  useWarmTabScreens({
    activeRouteName,
    navigation,
    preloadProtectedTabs,
    routes: visibleRoutes,
  });

  const capsuleStyle = useAnimatedStyle(() => {
    const currentPos = animIndex.get();
    const target = targetIndex.get();
    const distance = Math.abs(target - currentPos);
    const isAtRest = distance < 0.005;
    const stretchX = isAtRest ? 1 : 1 + Math.min(distance * 0.38, 0.3);
    const shrinkY = isAtRest ? 1 : 1 - Math.min(distance * 0.12, 0.1);
    const centerOffset = (tabWidth - CAPSULE_WIDTH) / 2;
    const translateX = currentPos * tabWidth + centerOffset + 8;

    return {
      position: 'absolute',
      width: CAPSULE_WIDTH,
      height: CAPSULE_HEIGHT,
      top: 6,
      borderRadius: CAPSULE_WIDTH / 2,
      backgroundColor: isDark
        ? 'rgba(220, 38, 38, 0.18)'
        : 'rgba(220, 38, 38, 0.08)',
      borderColor: isDark
        ? 'rgba(220, 38, 38, 0.45)'
        : 'rgba(220, 38, 38, 0.28)',
      borderWidth: 1,
      shadowColor: BRAND.primary,
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: isDark ? 0.38 : 0.14,
      shadowRadius: 5,
      elevation: 2,
      transform: [
        { translateX },
        { scaleX: stretchX * capsuleScale.get() },
        { scaleY: shrinkY * capsuleScale.get() },
      ] as ViewStyle['transform'],
      zIndex: 1,
    };
  });

  return (
    <View
      style={[styles.outerContainer, { pointerEvents: 'box-none' }]}
      testID="custom-tab-bar-wrapper"
    >
      {preloadProtectedTabs && walletIdx >= 0 ? (
        <WalletDiscoveryBubble
          homeFocused={activeRouteName === 'index'}
          walletCenter={8 + tabWidth * (walletIdx + 0.5)}
          availableWidth={screenWidth - 32}
        />
      ) : null}
      <BlurContainer
        intensity={Platform.OS === 'ios' ? 70 : 85}
        tint={isDark ? 'dark' : 'light'}
        style={[
          styles.tabBarContainer,
          {
            backgroundColor: isDark
              ? HAS_EXPO_BLUR
                ? 'rgba(24, 24, 27, 0.68)'
                : 'rgba(24, 24, 27, 0.92)'
              : HAS_EXPO_BLUR
                ? 'rgba(255, 255, 255, 0.72)'
                : 'rgba(255, 255, 255, 0.95)',
            borderColor: isDark
              ? 'rgba(255, 255, 255, 0.15)'
              : 'rgba(0, 0, 0, 0.08)',
          },
        ]}
        testID="custom-tab-bar"
      >
        <Animated.View style={capsuleStyle} testID="custom-tab-bar-capsule" />

        {visibleRoutes.map((route, index: number) => {
          const { options } = descriptors[route.key];
          const customOptions = options as CustomTabOptions;
          const isActiveRoute = activeRouteName === route.name;
          const isFocused = optimisticRouteName === route.name;

          const moveCapsule = (shouldPulse: boolean) => {
            targetIndex.set(index);
            animIndex.set(withSpring(index, MOVE_SPRING));

            capsuleScale.set(
              withSpring(
                shouldPulse ? 1.15 : 1,
                SCALE_PULSE_SPRING,
                (finished) => {
                  if (finished && shouldPulse) {
                    capsuleScale.set(withSpring(1, SCALE_REST_SPRING));
                  }
                }
              )
            );
          };

          const resetSelection = () => {
            setOptimisticRouteName(activeRouteName);
            targetIndex.set(safeActiveIdx);
            animIndex.set(withSpring(safeActiveIdx, MOVE_SPRING));
            capsuleScale.set(withSpring(1, SCALE_REST_SPRING));
          };

          const commitTabSelection = (shouldTriggerFeedback: boolean) => {
            if (!isActiveRoute) {
              setOptimisticRouteName(route.name);
              moveCapsule(shouldTriggerFeedback);
            }

            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });

            if (event.defaultPrevented) {
              resetSelection();
              return;
            }

            if (!isActiveRoute) {
              navigation.dispatch({
                ...TabActions.jumpTo(route.name, route.params),
                target: state.key,
              });
            }

            if (
              shouldTriggerFeedback &&
              !isActiveRoute &&
              Platform.OS !== 'web'
            ) {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }
          };

          const handlePressIn = () => {
            if (!isActiveRoute) {
              commitTabSelection(true);
              pressInHandledRouteKeyRef.current = route.key;
            }
          };

          const handlePress = () => {
            // press-in already committed this tap (snappy capsule + tabPress).
            // Clear the guard here — NOT in onPressOut, which RN fires before
            // onPress and would otherwise let this re-commit (double tabPress →
            // e.g. the auth listener pushing /auth/login twice).
            if (pressInHandledRouteKeyRef.current === route.key) {
              pressInHandledRouteKeyRef.current = null;
              return;
            }

            commitTabSelection(!isActiveRoute);
          };

          return (
            <CustomTabBarItem
              key={route.key}
              route={route}
              isFocused={isFocused}
              options={customOptions}
              colors={colors}
              onPress={handlePress}
              onPressIn={handlePressIn}
            />
          );
        })}
      </BlurContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 24 : 16,
    left: 16,
    right: 16,
    zIndex: 100,
    backgroundColor: 'transparent',
    paddingTop: 96,
    borderRadius: 999,
    ...getTabBarShadowStyle('native'),
  },
  tabBarContainer: {
    flexDirection: 'row',
    height: 64,
    borderRadius: 999,
    borderWidth: 0.5,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'space-between',
    position: 'relative',
    overflow: 'hidden',
  },
});
