import Ionicons, {
  type IoniconsIconName,
} from '@react-native-vector-icons/ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import * as NavigationBar from 'expo-navigation-bar';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  type FlatListProps,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { isRuntimePlatform } from '@/config/runtime-platform';
import {
  DARK_COLORS,
  RADIUS,
  SHADOWS,
  SPACING,
  TYPOGRAPHY,
} from '@/constants/theme';
import { useOnboarding } from '@/context/OnboardingContext';

// Define types for slides
interface OnboardingSlide {
  id: string;
  title: string;
  description: string;
  icon: IoniconsIconName;
  color: string;
  subtitle: string;
}

const VIEWABILITY_CONFIG = { viewAreaCoveragePercentThreshold: 50 };

const SLIDES: OnboardingSlide[] = [
  {
    id: '1',
    subtitle: 'AI Store Copilot',
    title: 'Design & Create',
    description:
      'Design with AI. Chat to customize your store and SEO instantly.',
    icon: 'storefront',
    color: '#C084FC', // Purple/Pink
  },
  {
    id: '2',
    subtitle: 'Automated Ad Sync',
    title: 'Attract Customers',
    description: '2x Better Ads. Auto-sync sales to Facebook & TikTok APIs.',
    icon: 'megaphone',
    color: '#60A5FA', // Blue/Teal
  },
  {
    id: '3',
    subtitle: 'Process Orders',
    title: 'Fulfill Ease',
    description: 'One-Tap Fulfillment. Dispatch riders and track deliveries.',
    icon: 'cube',
    color: '#FBBF24', // Gold
  },
  {
    id: '4',
    subtitle: 'Real-Time Analytics',
    title: 'Measure Success',
    description: 'Watch Your Growth. Monitor sales and best-sellers live.',
    icon: 'bar-chart',
    color: '#34D399', // Green
  },
  {
    id: '5',
    subtitle: 'Your Store',
    title: 'Freedom in Your Pocket',
    description: 'Manage Everything. Run your entire empire from your phone.',
    icon: 'phone-portrait',
    color: '#3B82F6', // Primary Blue
  },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const { completeOnboarding } = useOnboarding();
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [scrollX] = useState(() => new Animated.Value(0));
  const slidesRef = useRef<FlatList<OnboardingSlide>>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  // Refs for proper cleanup and avoiding stale closures
  const currentIndexRef = useRef(currentIndex);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);

  // Keep the ref in sync with state
  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    if (!isRuntimePlatform('android')) {
      return;
    }

    void NavigationBar.setStyle('light');
    return () => {
      void NavigationBar.setStyle(colorScheme === 'dark' ? 'light' : 'dark');
    };
  }, [colorScheme]);

  // Auto-swipe interval (3.5 seconds)
  const AUTO_SWIPE_INTERVAL = 3500;

  useEffect(() => {
    isMountedRef.current = true;

    intervalRef.current = setInterval(() => {
      if (isMountedRef.current) {
        const nextIndex = (currentIndexRef.current + 1) % SLIDES.length;
        slidesRef.current?.scrollToIndex({ index: nextIndex, animated: true });
      }
    }, AUTO_SWIPE_INTERVAL);

    return () => {
      isMountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []); // Run only once on mount

  const [viewableItemsChanged] = useState(
    () =>
      ({
        viewableItems,
      }: {
        viewableItems: Parameters<
          NonNullable<FlatListProps<unknown>['onViewableItemsChanged']>
        >[0]['viewableItems'];
      }) => {
        if (viewableItems && viewableItems.length > 0) {
          setCurrentIndex(viewableItems[0].index || 0);
        }
      }
  );

  const handleSignIn = async () => {
    try {
      await completeOnboarding();
      router.replace('/(auth)/login');
    } catch (error) {
      console.error('Error completing onboarding:', error);
    }
  };

  const renderItem = ({ item }: { item: OnboardingSlide }) => {
    return (
      <View style={[styles.slide, { width }]}>
        <View style={styles.contentContainer}>
          {/* Icon Section with Glow */}
          <View style={styles.iconContainer}>
            <View
              style={[
                styles.glowRing,
                { backgroundColor: item.color, opacity: 0.15 },
              ]}
            />
            <View
              style={[
                styles.glowInner,
                { backgroundColor: item.color, opacity: 0.1 },
              ]}
            />
            <LinearGradient
              colors={[item.color, 'rgba(255,255,255,0.1)']}
              style={styles.iconCircle}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <Ionicons name={item.icon} size={48} color="#FFF" />
            </LinearGradient>
          </View>

          {/* Text Content */}
          <View style={styles.textContainer}>
            <Text style={[styles.subtitle, { color: item.color }]}>
              {item.subtitle.toUpperCase()}
            </Text>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.description}>{item.description}</Text>
          </View>
        </View>
      </View>
    );
  };
  const footerPaddingBottom = insets.bottom > 0 ? SPACING.lg : SPACING.xl;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Premium Dark Background Gradient */}
      <LinearGradient
        colors={['#0D0D1A', '#1A1A2E', '#0F172A']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />

      <SafeAreaView style={styles.safeArea}>
        <FlatList
          data={SLIDES}
          renderItem={renderItem}
          horizontal
          showsHorizontalScrollIndicator={false}
          pagingEnabled
          bounces={false}
          keyExtractor={(item) => item.id}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { x: scrollX } } }],
            {
              useNativeDriver: false,
            }
          )}
          scrollEventThrottle={32}
          onViewableItemsChanged={viewableItemsChanged}
          viewabilityConfig={VIEWABILITY_CONFIG}
          ref={slidesRef}
          style={styles.carousel}
          getItemLayout={(_, index) => ({
            length: width,
            offset: width * index,
            index,
          })}
        />

        {/* Footer with Pagination and Auth Buttons */}
        <View style={[styles.footer, { paddingBottom: footerPaddingBottom }]}>
          {/* Pagination Indicators */}
          <View style={styles.paginator}>
            {SLIDES.map((_, i) => {
              const inputRange = [(i - 1) * width, i * width, (i + 1) * width];

              const dotWidth = scrollX.interpolate({
                inputRange,
                outputRange: [8, 24, 8],
                extrapolate: 'clamp',
              });

              const opacity = scrollX.interpolate({
                inputRange,
                outputRange: [0.3, 1, 0.3],
                extrapolate: 'clamp',
              });

              return (
                <Animated.View
                  key={i.toString()}
                  style={[
                    styles.dot,
                    {
                      width: dotWidth,
                      opacity,
                      backgroundColor:
                        i === currentIndex ? SLIDES[i].color : '#FFF',
                    },
                  ]}
                />
              );
            })}
          </View>

          {/* Auth Buttons */}
          <View style={styles.authButtons}>
            {/* Sign In - Primary */}
            <Pressable
              style={({ pressed }) => [
                styles.signInButton,
                pressed && { transform: [{ scale: 0.98 }] },
              ]}
              onPress={handleSignIn}
            >
              <LinearGradient
                colors={[DARK_COLORS.gold, '#D4A74A']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.signInGradient}
              >
                <Text style={styles.signInText}>Sign In</Text>
              </LinearGradient>
            </Pressable>

            {/* Create Account - Secondary */}
            <Pressable
              style={({ pressed }) => [
                styles.createAccountButton,
                pressed && { opacity: 0.8 },
              ]}
              onPress={() => router.push('/(auth)/register')}
            >
              <Text style={styles.createAccountText}>Create an account</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0D1A',
  },
  safeArea: {
    flex: 1,
  },
  carousel: {
    flex: 1,
  },
  slide: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING['3xl'],
  },
  contentContainer: {
    alignItems: 'center',
    width: '100%',
  },
  // Icon Styles
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 200,
    height: 200,
    marginBottom: SPACING['3xl'],
  },
  glowRing: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
  },
  glowInner: {
    position: 'absolute',
    width: 130,
    height: 130,
    borderRadius: 65,
  },
  iconCircle: {
    width: 100,
    height: 100,
    borderRadius: 35,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    ...SHADOWS.lg,
  },
  // Text Styles
  textContainer: {
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
  },
  subtitle: {
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    fontSize: TYPOGRAPHY.size.xs,
    letterSpacing: 2,
    marginBottom: SPACING.sm,
  },
  title: {
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    fontSize: 32,
    color: '#FFF',
    textAlign: 'center',
    lineHeight: 40,
    marginBottom: SPACING.lg,
  },
  description: {
    fontFamily: TYPOGRAPHY.fontFamily.medium,
    fontSize: TYPOGRAPHY.size.md,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: '90%',
  },
  // Footer Styles
  footer: {
    paddingHorizontal: SPACING['2xl'],
    gap: SPACING.lg,
  },
  paginator: {
    flexDirection: 'row',
    justifyContent: 'center',
    height: 24,
    alignItems: 'center',
  },
  dot: {
    height: 8,
    borderRadius: 4,
    marginHorizontal: 4,
  },
  // Auth Button Styles
  authButtons: {
    gap: SPACING.md,
  },
  signInButton: {
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    ...SHADOWS.md,
  },
  signInGradient: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
  },
  signInText: {
    color: '#1A1A2E',
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    fontSize: TYPOGRAPHY.size.md,
  },
  createAccountButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  createAccountText: {
    color: '#FFF',
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
    fontSize: TYPOGRAPHY.size.md,
  },
});
