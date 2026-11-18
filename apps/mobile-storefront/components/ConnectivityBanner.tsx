import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { palette } from '@/constants/Colors';
import { getConnectivityBannerShadowStyle } from './ConnectivityBanner.shadows';

type BannerState = 'hidden' | 'offline' | 'online';

const BANNER_COLORS = {
  offline: {
    background: palette.amber[100],
    text: palette.amber[800],
    icon: palette.amber[600],
  },
  online: {
    background: palette.emerald[100],
    text: palette.emerald[800],
    icon: palette.emerald[600],
  },
} as const;

export function ConnectivityBanner() {
  const insets = useSafeAreaInsets();
  const [bannerState, setBannerState] = useState<BannerState>('hidden');
  const wasOffline = useRef(false);
  // Timer ref for auto-hide cleanup - prevents memory leaks (2026 Best Practice)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Animation values
  const translateY = useSharedValue(-100);
  const opacity = useSharedValue(0);

  // Monitor network connectivity
  useEffect(() => {
    const showBanner = (state: 'offline' | 'online') => {
      setBannerState(state);
      translateY.set(
        withTiming(0, {
          duration: 300,
          easing: Easing.out(Easing.cubic),
        })
      );
      opacity.set(withTiming(1, { duration: 200 }));
    };

    const hideBanner = () => {
      // Slides back up: the banner sits in the layout above every screen.
      translateY.set(
        withTiming(-100, {
          duration: 300,
          easing: Easing.in(Easing.cubic),
        })
      );
      opacity.set(
        withTiming(0, { duration: 200 }, () => {
          scheduleOnRN(setBannerState, 'hidden');
        })
      );
    };

    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      // Only show offline if explicitly disconnected, allow null/unknown states
      const isConnected = state.isConnected === true;

      if (!isConnected) {
        // Going offline - clear any pending hide timer
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }
        wasOffline.current = true;
        showBanner('offline');
      } else if (wasOffline.current) {
        // Coming back online after being offline
        showBanner('online');

        // Clear any existing timer before setting a new one (2026 Best Practice)
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
        }
        // Auto-hide after 2 seconds
        hideTimerRef.current = setTimeout(() => {
          hideBanner();
          wasOffline.current = false;
          hideTimerRef.current = null;
        }, 2000);
      }
    });

    // Check initial state
    NetInfo.fetch().then((state) => {
      // Only show offline if explicitly disconnected, allow null/unknown states
      const isConnected = state.isConnected === true;
      if (!isConnected) {
        wasOffline.current = true;
        showBanner('offline');
      }
    });

    // Cleanup on unmount - prevents memory leaks
    return () => {
      unsubscribe();
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, [translateY, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.get() }],
    opacity: opacity.get(),
  }));
  const isOffline = bannerState === 'offline';
  const bannerColors = isOffline ? BANNER_COLORS.offline : BANNER_COLORS.online;
  const isVisible = bannerState !== 'hidden';
  // In the layout flow, so it pushes every screen (and its header) down
  // instead of covering it; takes no space while hidden.
  if (!isVisible) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          paddingTop: insets.top + 8,
          backgroundColor: bannerColors.background,
        },
        animatedStyle,
      ]}
    >
      <View style={styles.content}>
        <Ionicons
          name={
            isOffline ? 'cloud-offline-outline' : 'checkmark-circle-outline'
          }
          size={18}
          color={bannerColors.icon}
        />
        <Text style={[styles.text, { color: bannerColors.text }]}>
          {isOffline
            ? "You're offline. Browse what you've seen!"
            : 'Back Online!'}
        </Text>
      </View>
    </Animated.View>
  );
}

/**
 * Hook to get current connectivity status
 */
export function useConnectivity() {
  const [isConnected, setIsConnected] = useState(true);
  const [isInternetReachable, setIsInternetReachable] = useState(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsConnected(state.isConnected ?? false);
      setIsInternetReachable(state.isInternetReachable ?? true);
    });

    return () => unsubscribe();
  }, []);

  return {
    isConnected,
    isInternetReachable,
    isOnline: isConnected && isInternetReachable !== false,
  };
}

const styles = StyleSheet.create({
  container: {
    zIndex: 1000,
    paddingHorizontal: 16,
    paddingBottom: 12,
    ...getConnectivityBannerShadowStyle(
      Platform.OS === 'web' ? 'web' : 'native'
    ),
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  text: {
    fontSize: 14,
    fontWeight: '600',
  },
});
