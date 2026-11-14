import Ionicons, {
  type IoniconsIconName,
} from '@react-native-vector-icons/ionicons';
import { type Href, useRouter } from 'expo-router';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, {
  BRAND,
  palette,
  RADIUS,
  SPACING,
  withAlpha,
} from '@/constants/Colors';

import { useHomeOrderShortcuts } from '@/hooks/use-home-order-shortcuts';

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
const CARD_GAP = SPACING.sm;

export function HomeServiceCards({
  placement = 'belowUtility',
}: HomeServiceCardsProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const router = useRouter();
  const { width, fontScale } = useWindowDimensions();
  const isCompact = width < COMPACT_BREAKPOINT;
  const orderShortcuts = useHomeOrderShortcuts(placement === 'underSearch');

  if (placement === 'underSearch') {
    const columns = Math.max(
      2,
      Math.min(4, Math.floor(width / (85 * fontScale)))
    );
    const tileWidth =
      (width - SPACING.md * 2 - CARD_GAP * (columns - 1)) / columns;
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

const styles = StyleSheet.create({
  outerContainer: {
    width: '100%',
  },
  scrollContainer: {
    paddingHorizontal: SPACING.md,
    flexDirection: 'row',
    gap: CARD_GAP,
  },
  featureGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: SPACING.md,
    paddingTop: 8,
    paddingBottom: 8,
    marginBottom: 4,
    gap: CARD_GAP,
  },
  pointsRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingTop: 5,
    paddingBottom: 12,
  },
  pointsTitle: {
    color: '#fff',
    textAlign: 'center',
    fontSize: 10,
    fontWeight: '700',
    flexShrink: 1,
  },
  featureTile: {
    minHeight: 73,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 7,
    paddingVertical: 8,
    gap: 4,
  },
  featureIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureTitle: {
    textAlign: 'center',
    fontSize: 11,
    lineHeight: 13,
    fontWeight: '700',
  },
  aboveUtility: {
    marginTop: 8,
    marginBottom: -8,
    transform: [{ translateY: -14 }],
  },
  belowUtility: {
    marginTop: 28,
    marginBottom: -2,
  },
  card: {
    flexDirection: 'row',
    gap: 6,
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    position: 'relative',
  },
  cardPressable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    zIndex: 1,
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: '100%',
  },
  icon: {
    marginRight: 6,
  },
  title: {
    fontFamily: 'Inter_700Bold',
    fontWeight: 'bold',
    fontSize: 13,
    lineHeight: 15,
    flexShrink: 1,
  },
  compactTitle: {
    fontSize: 11,
  },
});
