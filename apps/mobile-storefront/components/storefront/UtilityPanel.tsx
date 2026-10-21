import type Ionicons from '@react-native-vector-icons/ionicons';
import { useIsFocused } from 'expo-router/react-navigation';
// router removed as it was unused.
import type React from 'react';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import Animated, {
  type SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { BRAND } from '@/constants/Colors';
import { type Category, useCategories } from '@/hooks';
import { usePrefetchBillers } from '@/hooks/use-vtu-billers';
import { CONFIG } from '@/lib/config';
import { getTemplateConfig } from '@/lib/templates';
import { utilityPanelStyles as styles } from './UtilityPanel.styles';
import { UtilityPanelCategoryItem } from './UtilityPanelCategoryItem';

interface UtilityPanelProps {
  variant?: 'card' | 'circle' | 'pill';
  selectedCategoryId: string | null;
  onCategorySelect: (id: string | null) => void;
  selectedCategoryName?: string;
  slug?: string;
  activeIndex?: SharedValue<number>;
}

// Module-level constants (stable references, no re-creation per render)
const UTILITY_WORDS = ['Airtime!', 'Data!', 'Tv!', 'Power!', 'Gaming!'];
const CATEGORY_IDS = ['u-airtime', 'u-data', 'u-tv', 'u-power', 'u-gaming'];

export function UtilityPanel({
  variant = 'circle',
  selectedCategoryId,
  onCategorySelect,
  slug,
  activeIndex,
}: UtilityPanelProps) {
  const { data: remoteCategories = [], isLoading, error } = useCategories();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  // Prefetch all bill categories so data is ready when user taps a category
  usePrefetchBillers();

  const isFocused = useIsFocused();

  // Web-Parity Auto-Rotation Logic (constants at module level for stable references)
  const template = getTemplateConfig(CONFIG.BUSINESS_TYPE, CONFIG.TEMPLATE_ID);
  const defaultCategoryId =
    template.headerStyle === 'elite' ? 'u-airtime' : null;

  const [activeUtilityIndex, setActiveUtilityIndex] = useState(0);
  const [isManualUtility, setIsManualUtility] = useState(() => {
    return selectedCategoryId
      ? selectedCategoryId !== defaultCategoryId
      : false;
  });
  const promoWordProgress = useSharedValue(1);

  // Re-sync manual mode during render (instead of an effect) so users never
  // see a stale frame between the prop change and the adjustment.
  const [prevSync, setPrevSync] = useState({
    defaultCategoryId,
    isFocused,
    selectedCategoryId,
  });
  if (
    prevSync.isFocused !== isFocused ||
    prevSync.selectedCategoryId !== selectedCategoryId ||
    prevSync.defaultCategoryId !== defaultCategoryId
  ) {
    setPrevSync({ defaultCategoryId, isFocused, selectedCategoryId });
    if (isFocused) {
      setIsManualUtility(
        selectedCategoryId ? selectedCategoryId !== defaultCategoryId : false
      );
    }
  }

  const animatedPromoStyle = useAnimatedStyle(() => {
    const translateY = (1 - promoWordProgress.value) * 4;
    return {
      opacity: promoWordProgress.value,
      transform: [{ translateY }],
    };
  });

  const localActiveIndex = useSharedValue(0);
  const activeIndexVal = activeIndex ?? localActiveIndex;

  // Sync reaction from activeIndexVal to activeUtilityIndex state
  useAnimatedReaction(
    () => Math.round(activeIndexVal.value),
    (nextIndex, prevIndex) => {
      if (nextIndex !== prevIndex) {
        scheduleOnRN(setActiveUtilityIndex, nextIndex);
      }
    },
    [activeIndexVal]
  );

  // Sync prop change to local index (if external change happens)
  useEffect(() => {
    if (selectedCategoryId) {
      const idx = CATEGORY_IDS.indexOf(selectedCategoryId);
      if (idx !== -1) {
        activeIndexVal.set(withSpring(idx, { damping: 16, stiffness: 150 }));
      }
    }
  }, [selectedCategoryId, activeIndexVal]);

  // Auto-rotate effect
  useEffect(() => {
    // Home stays mounted under native-stack routes. Pause its timer while
    // covered so hidden promo animations do not keep updating Fabric.
    if (isManualUtility || !isFocused) return;

    const interval = setInterval(() => {
      const currentVal = Math.round(activeIndexVal.get());
      const next = (currentVal + 1) % UTILITY_WORDS.length;
      if (next === 0) {
        activeIndexVal.set(0); // Instant jump back to 0, no backward sweep!
      } else {
        activeIndexVal.set(withTiming(next, { duration: 300 }));
      }
    }, 2800); // Slightly slower for better readability

    return () => clearInterval(interval);
  }, [isManualUtility, activeIndexVal, isFocused]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: activeUtilityIndex intentionally restarts the promo text transition when the selected utility changes.
  useEffect(() => {
    promoWordProgress.set(0);
    promoWordProgress.set(
      withTiming(1, {
        duration: 260,
      })
    );
  }, [activeUtilityIndex, promoWordProgress]);

  const handlePress = (id: string, index: number) => {
    setIsManualUtility(true);
    setActiveUtilityIndex(index);
    activeIndexVal.set(withSpring(index, { damping: 16, stiffness: 150 }));
    onCategorySelect(id);
  };

  const categories = (() => {
    // 2026 Best Practice: Default to utilities if slug matches or is unspecified (safe fallback for this specialized component)
    if (!slug || slug === 'utility' || slug === 'utilities') {
      return [
        {
          id: 'u-airtime',
          name: 'Airtime',
          slug: 'airtime',
          icon: 'call-outline',
        },
        { id: 'u-data', name: 'Data', slug: 'data', icon: 'wifi' },
        { id: 'u-tv', name: 'Tv', slug: 'tv', icon: 'tv-outline' },
        { id: 'u-power', name: 'Power', slug: 'power', icon: 'flash-outline' },
        {
          id: 'u-gaming',
          name: 'Gaming',
          slug: 'gaming',
          icon: 'game-controller-outline',
        },
      ];
    }
    return (remoteCategories || []) as Category[];
  })();

  if (isLoading && categories.length === 0) {
    return (
      <View
        style={[
          styles.container,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <ActivityIndicator size="small" color={BRAND.primary} />
      </View>
    );
  }

  // 2026 Best Practice: "Elite" aesthetic requires specific handling for the Utility Panel
  // We want the 'Card' container look (white bg, border) BUT 'Circle' item variant (icons)
  // regardless of what the global template says (which might be 'card' implying square items).
  const isUtility = !slug || slug === 'utility' || slug === 'utilities';
  const hasCategoryError = Boolean(error) && !isUtility;
  const showContainer = variant === 'card' || isUtility;
  const itemVariant = isUtility ? 'circle' : variant; // Force circle icons for utilities
  const activeUtilityWord = UTILITY_WORDS[activeUtilityIndex] || 'Airtime!';

  if (hasCategoryError) {
    return (
      <View
        style={[
          styles.container,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.errorTitle, { color: colors.text }]}>
          Unable to load categories
        </Text>
        <Text style={[styles.errorMessage, { color: colors.textSecondary }]}>
          Please try again in a moment.
        </Text>
      </View>
    );
  }

  return (
    <View
      style={
        showContainer
          ? [
              styles.container,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]
          : styles.minimalContainer
      }
    >
      {/* Dynamic Unified Banner */}
      <View
        accessible
        accessibilityRole="summary"
        accessibilityLabel={`We Pay YOU When You Buy ${activeUtilityWord}`}
        style={[
          styles.promoBanner,
          { backgroundColor: colors.promoBackground },
        ]}
      >
        <View style={{ height: 16, justifyContent: 'center' }}>
          <Text style={[styles.promoText, { color: colors.textSecondary }]}>
            We Pay <Text style={styles.promoHighlight}>YOU</Text> When You Buy{' '}
            <Animated.Text style={[styles.promoHighlight, animatedPromoStyle]}>
              {activeUtilityWord}
            </Animated.Text>
          </Text>
        </View>
      </View>
      <View style={styles.categoriesContent}>
        {categories.map((category, index) => (
          <UtilityPanelCategoryItem
            key={category.id}
            id={category.id}
            name={category.name}
            iconName={
              category.icon as React.ComponentProps<typeof Ionicons>['name']
            }
            variant={itemVariant}
            // Active if: (Manual Interaction & matches selection) OR (Auto Mode & index matches)
            isActive={
              isManualUtility && selectedCategoryId
                ? category.id === selectedCategoryId
                : activeUtilityIndex === index
            }
            onPress={() => handlePress(category.id, index)}
            activeIndex={isUtility ? activeIndexVal : undefined}
            index={isUtility ? index : undefined}
          />
        ))}
      </View>
    </View>
  );
}
