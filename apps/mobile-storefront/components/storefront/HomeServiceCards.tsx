import Ionicons, {
  type IoniconsIconName,
} from '@react-native-vector-icons/ionicons';
import { type Href, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { BRAND, palette, SPACING, withAlpha } from '@/constants/Colors';

import { useHomeOrderShortcuts } from '@/hooks/use-home-order-shortcuts';

import { CARD_GAP, styles } from './HomeServiceCards.styles';
import { ShortcutTileBackdrop } from './ShortcutTileBackdrop';

type ServiceShortcut = {
  title: string;
  subtitle: string;
  href: Href;
  icon: IoniconsIconName;
  accent: string;
};

type HomeServiceCardsPlacement =
  | 'aboveUtility'
  | 'belowUtility'
  | 'underSearch';

type HomeServiceCardsProps = {
  placement?: HomeServiceCardsPlacement;
};

const SERVICE_SHORTCUTS: ServiceShortcut[] = [
  {
    title: 'IMEI Checker',
    subtitle: 'Verify before buying',
    href: '/imei-check',
    icon: 'barcode-outline',
    accent: BRAND.primary,
  },
  {
    title: 'Repair Lab',
    subtitle: 'Fix phones fast',
    href: '/repairs',
    icon: 'construct-outline',
    accent: palette.amber[500],
  },
  {
    title: 'Swap/Trade',
    subtitle: 'Swap for credit',
    href: '/swap',
    icon: 'swap-horizontal-outline',
    accent: palette.emerald[500],
  },
  {
    title: 'SuperQuiz',
    subtitle: 'Play for rewards',
    href: '/quiz',
    icon: 'trophy-outline',
    accent: palette.red[500],
  },
];

const HOME_FEATURES: ServiceShortcut[] = [
  ...SERVICE_SHORTCUTS.slice(0, 3),
  {
    title: 'Pay Small Small',
    subtitle: 'Shop devices and check eligibility for installments at checkout',
    href: {
      pathname: '/category/[slug]',
      params: { slug: 'phones', sort: 'price_asc' },
    },
    icon: 'card-outline',
    accent: '#a34d16',
  },
  {
    title: 'Save & Earn',
    subtitle: 'Explore device savings in Wallet',
    href: '/wallet',
    icon: 'wallet-outline',
    accent: '#087a58',
  },
  {
    title: 'Receipts',
    subtitle: 'Find your digital receipts',
    href: '/receipts',
    icon: 'receipt-outline',
    accent: '#3158a7',
  },
  {
    title: 'Track Order',
    subtitle: 'Check your delivery status',
    href: '/orders',
    icon: 'cube-outline',
    accent: '#8a5232',
  },
  SERVICE_SHORTCUTS[3],
];

const returnsShortcut: ServiceShortcut = {
  title: 'Return Policy',
  subtitle: 'Read the Ogabassey return policy',
  href: '/returns',
  icon: 'return-down-back-outline',
  accent: '#3158a7',
};

const protectionShortcut: ServiceShortcut = {
  title: 'Device Protection',
  subtitle: 'Learn about Ogabassey Assurance',
  href: '/device-protection',
  icon: 'shield-checkmark-outline',
  accent: '#8a5232',
};

const CARD_HEIGHT = 42;
const COMPACT_CARD_HEIGHT = 38;
const COMPACT_BREAKPOINT = 360;

export function HomeServiceCards({
  placement = 'belowUtility',
}: HomeServiceCardsProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const router = useRouter();
  const { width, fontScale } = useWindowDimensions();
  const [featureGridWidth, setFeatureGridWidth] = useState(0);
  const isCompact = width < COMPACT_BREAKPOINT;
  const orderShortcuts = useHomeOrderShortcuts(placement === 'underSearch');

  if (placement === 'underSearch') {
    const availableWidth = featureGridWidth || width;
    const columns = Math.max(
      2,
      Math.min(4, Math.floor(availableWidth / (85 * fontScale)))
    );
    const tileWidth =
      (availableWidth - SPACING.md * 2 - CARD_GAP * (columns - 1)) / columns;
    const features = HOME_FEATURES.map((item) => {
      if (item.href === '/receipts' && !orderShortcuts?.receipts)
        return returnsShortcut;
      if (item.href === '/orders' && !orderShortcuts?.tracking)
        return protectionShortcut;
      return item;
    });
    const isDark = colorScheme === 'dark';

    return (
      <View
        accessibilityLabel="Ogabassey features"
        onLayout={({ nativeEvent: { layout } }) =>
          setFeatureGridWidth(layout.width)
        }
        testID="home-service-cards"
        style={[
          styles.featureGrid,
          { backgroundColor: isDark ? '#181416' : colors.black },
        ]}
      >
        {features.map((item) => (
          <Pressable
            key={item.title}
            accessibilityRole="button"
            accessibilityLabel={`${item.title}. ${item.subtitle}`}
            onPress={() => router.push(item.href)}
            style={[styles.featureTile, { width: tileWidth }]}
          >
            <ShortcutTileBackdrop color={isDark ? colors.muted : colors.card} />
            <View
              style={[
                styles.featureIcon,
                {
                  backgroundColor: withAlpha(item.accent, isDark ? 0.24 : 0.12),
                },
              ]}
            >
              <Ionicons
                name={item.icon}
                size={20}
                color={isDark ? '#fff' : item.accent}
              />
            </View>
            <Text style={[styles.featureTitle, { color: colors.text }]}>
              {item.title}
            </Text>
          </Pressable>
        ))}
        <View style={styles.pointsRow}>
          <Ionicons
            name="shield-checkmark-outline"
            size={13}
            color={isDark ? '#fff' : '#ffc1c3'}
            accessible={false}
            importantForAccessibility="no"
          />
          <Text style={styles.pointsTitle}>Ogabassey Never Disappoints!</Text>
        </View>
      </View>
    );
  }

  const cardWidth = isCompact ? 98 : 114;
  const cardHeight = isCompact ? COMPACT_CARD_HEIGHT : CARD_HEIGHT;

  return (
    <View
      style={[
        styles.outerContainer,
        placement === 'aboveUtility'
          ? styles.aboveUtility
          : styles.belowUtility,
      ]}
      testID="home-service-cards"
      accessibilityLabel="Device services"
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContainer}
      >
        {SERVICE_SHORTCUTS.map((item) => {
          return (
            <View
              key={item.href.toString()}
              style={[
                styles.card,
                {
                  backgroundColor: colors.card,
                  borderColor: withAlpha(
                    item.accent,
                    colorScheme === 'dark' ? 0.48 : 0.38
                  ),
                  width: cardWidth,
                  height: cardHeight,
                },
              ]}
            >
              <Pressable
                onPress={() => router.push(item.href)}
                style={styles.cardPressable}
                accessibilityRole="button"
                accessibilityLabel={`${item.title}. ${item.subtitle}`}
              >
                <View style={styles.cardContent}>
                  <Ionicons
                    name={item.icon}
                    size={isCompact ? 16 : 18}
                    color={item.accent}
                    style={styles.icon}
                  />
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.78}
                    style={[
                      styles.title,
                      { color: colors.text },
                      isCompact && styles.compactTitle,
                    ]}
                  >
                    {item.title}
                  </Text>
                </View>
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
