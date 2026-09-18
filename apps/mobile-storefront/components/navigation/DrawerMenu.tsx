import Ionicons from '@react-native-vector-icons/ionicons';
import Constants from 'expo-constants';
import { router, usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  BackHandler,
  Dimensions,
  InteractionManager,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { useShallow } from 'zustand/react/shallow';
import { AdSlot } from '@/components/ads/AdSlot';
import { GadgetPattern } from '@/components/storefront/GadgetPattern';
import { Logo } from '@/components/ui/Logo';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { BRAND } from '@/constants/Colors';
import { getOptionalGestureHandlerRuntime } from '@/lib/optional-gesture-handler';
import { useAuthStore } from '@/stores/auth-store';
import { useDrawerStore } from '@/stores/drawer-store';
import { getDrawerMenuShadowStyles } from './DrawerMenu.shadows';
import styles from './DrawerMenu.styles';
import { DrawerMenuFooter } from './DrawerMenuFooter';
import { DrawerMenuItems } from './DrawerMenuItems';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const DRAWER_WIDTH = Math.min(SCREEN_WIDTH * 0.85, 320);
const ANIMATION_DURATION = 300;

export function DrawerMenu() {
  const { Gesture, GestureDetector } = getOptionalGestureHandlerRuntime();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { isOpen, closeDrawer } = useDrawerStore(
    useShallow((s) => ({ isOpen: s.isOpen, closeDrawer: s.closeDrawer }))
  );
  const { user, signOut } = useAuthStore(
    useShallow((s) => ({ user: s.user, signOut: s.signOut }))
  );
  const isAuthenticated = !!user;
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const drawerShadowStyles = getDrawerMenuShadowStyles(
    Platform.OS === 'web' ? 'web' : 'native'
  );

  const appVersion = Constants.expoConfig?.version ?? '1.0.0';
  const currentYear = new Date().getFullYear();
  const [shouldRenderPattern, setShouldRenderPattern] = useState(isOpen);

  // Animation values
  const translateX = useSharedValue(-DRAWER_WIDTH);
  const backdropOpacity = useSharedValue(0);

  useEffect(() => {
    if (isOpen) {
      setShouldRenderPattern(true);
      translateX.set(
        withTiming(0, {
          duration: ANIMATION_DURATION,
          easing: Easing.out(Easing.cubic),
        })
      );
      backdropOpacity.set(withTiming(1, { duration: ANIMATION_DURATION }));
    } else {
      translateX.set(
        withTiming(
          -DRAWER_WIDTH,
          {
            duration: ANIMATION_DURATION,
            easing: Easing.in(Easing.cubic),
          },
          (finished) => {
            if (finished) scheduleOnRN(setShouldRenderPattern, false);
          }
        )
      );
      backdropOpacity.set(withTiming(0, { duration: ANIMATION_DURATION }));
    }
  }, [isOpen, translateX, backdropOpacity]);

  // Android back button
  useEffect(() => {
    if (Platform.OS === 'android' && isOpen) {
      const backHandler = BackHandler.addEventListener(
        'hardwareBackPress',
        () => {
          closeDrawer();
          return true;
        }
      );
      return () => backHandler.remove();
    }
  }, [isOpen, closeDrawer]);

  // Swipe gesture to close
  const panGesture = Gesture
    ? Gesture.Pan()
        .activeOffsetX(-10)
        .onUpdate((event) => {
          if (event.translationX < 0) {
            translateX.set(Math.max(event.translationX, -DRAWER_WIDTH));
            backdropOpacity.set(
              interpolate(translateX.get(), [-DRAWER_WIDTH, 0], [0, 1])
            );
          }
        })
        .onEnd((event) => {
          if (event.translationX < -80 || event.velocityX < -500) {
            translateX.set(withTiming(-DRAWER_WIDTH, { duration: 200 }));
            backdropOpacity.set(withTiming(0, { duration: 200 }));
            scheduleOnRN(closeDrawer);
          } else {
            translateX.set(withTiming(0, { duration: 200 }));
            backdropOpacity.set(withTiming(1, { duration: 200 }));
          }
        })
    : null;

  const drawerAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.get() }],
  }));

  // H4 fix: Use isOpen directly for style.pointerEvents since useDerivedValue
  // reads .value at render time (JS thread snapshot), not reactively during animation.

  const backdropAnimatedStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.get(),
  }));

  const handleNavigate = (path: string) => {
    closeDrawer();
    router.push(path as import('expo-router').Href);
  };

  const confirmSignOut = () => {
    InteractionManager.runAfterInteractions(() => {
      signOut()
        .then(() => {
          router.replace('/');
        })
        .catch((err: unknown) => {
          console.error('Sign-out failed:', err);
          Alert.alert(
            'Sign Out Failed',
            'Unable to complete sign out. Please try again.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Retry', onPress: confirmSignOut },
            ]
          );
        });
    });
  };

  const handleSignOut = () => {
    closeDrawer();
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: confirmSignOut,
      },
    ]);
  };

  const handleSignIn = () => {
    closeDrawer();
    router.push('/auth/login');
  };

  return (
    <View style={[StyleSheet.absoluteFill, styles.passThroughContainer]}>
      {/* Backdrop interaction is driven by isOpen for reliable tappability. */}
      <Animated.View
        style={[
          styles.backdrop,
          backdropAnimatedStyle,
          { pointerEvents: isOpen ? 'auto' : 'none' },
        ]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={closeDrawer} />
      </Animated.View>

      {/* Drawer — L1 fix: Use theme-aware colors instead of hardcoded white */}
      <GestureDetector gesture={panGesture ?? undefined}>
        <Animated.View
          style={[
            styles.drawer,
            drawerShadowStyles.drawer,
            {
              paddingTop: insets.top,
              width: DRAWER_WIDTH,
              backgroundColor: colors.card,
              overflow: 'hidden',
            },
            drawerAnimatedStyle,
            { pointerEvents: isOpen ? 'auto' : 'none' },
          ]}
        >
          {shouldRenderPattern && (
            <View style={{ ...StyleSheet.absoluteFill, overflow: 'hidden' }}>
              <GadgetPattern
                colorScheme={colorScheme ?? 'light'}
                opacity={colorScheme === 'dark' ? 0.04 : 0.08}
                height={SCREEN_HEIGHT}
                variant="default"
                color={colorScheme === 'dark' ? '#ffffff' : BRAND.primary}
              />
            </View>
          )}
          {/* Header */}
          <View
            style={[
              styles.header,
              {
                borderBottomColor: colors.border,
                backgroundColor: colors.card,
              },
            ]}
          >
            <Logo
              width={120}
              height={24}
              color={colorScheme === 'dark' ? 'white' : 'black'}
            />
            <Pressable
              onPress={closeDrawer}
              style={styles.closeButton}
              hitSlop={12}
              accessibilityLabel="Close menu"
              accessibilityRole="button"
            >
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>

          <DrawerMenuItems
            colors={{
              icon: colors.icon,
              text: colors.text,
              textSecondary: colors.textSecondary,
              card: colors.card,
            }}
            isAuthenticated={isAuthenticated}
            pathname={pathname}
            onNavigate={handleNavigate}
          />
          {/* Mounted only while the drawer is open: the drawer stays mounted
          (translated off-screen) when closed, and an always-mounted slot
          would request and attribute impressions nobody can see. */}
          {isOpen ? <AdSlot placement="FOOTER_ANCHOR" /> : null}

          {/* Footer */}
          <DrawerMenuFooter
            appVersion={appVersion}
            authButtonShadowStyle={drawerShadowStyles.authButton}
            bottomInset={insets.bottom}
            colors={{
              background: colors.background,
              border: colors.border,
              foreground: colors.foreground,
              muted: colors.muted,
              textSecondary: colors.textSecondary,
            }}
            currentYear={currentYear}
            isAuthenticated={isAuthenticated}
            onAuthPress={isAuthenticated ? handleSignOut : handleSignIn}
          />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
