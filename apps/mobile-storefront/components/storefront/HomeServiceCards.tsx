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

type ServiceShortcut = {
  title: string;
  subtitle: string;
  href: Href;
  icon: IoniconsIconName;
  accent: string;
};

type HomeServiceCardsPlacement = 'aboveUtility' | 'belowUtility';

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
  const { width } = useWindowDimensions();
  const isCompact = width < COMPACT_BREAKPOINT;

  // Horizontal scroll: Scale down slightly so part of the last card (SuperQuiz) is visible
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
