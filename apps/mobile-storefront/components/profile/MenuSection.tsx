import Ionicons from '@react-native-vector-icons/ionicons';
import * as Haptics from 'expo-haptics';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { RADIUS, SHADOWS, SPACING } from '@/constants/Colors';

export interface MenuItem {
  id: string;
  icon: string;
  label: string;
  subLabel: string;
  color: string;
  badge?: number;
  action?: () => void;
  route?: string;
}

interface MenuSectionProps {
  title: string;
  items: MenuItem[];
  colors: {
    text: string;
    textSecondary: string;
    card: string;
    border: string;
    background?: string;
  };
  delayIndex?: number;
  puzzle?: boolean;
  onItemPress: (item: MenuItem) => void;
}

export function MenuSection({
  title,
  items,
  colors,
  delayIndex = 0,
  puzzle = false,
  onItemPress,
}: MenuSectionProps) {
  const handlePress = (item: MenuItem) => {
    if (Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {
        // Haptics failures are non-critical; ignore silently.
      });
    }
    onItemPress(item);
  };

  return (
    <Animated.View
      entering={FadeInDown.delay(200 + delayIndex * 100).duration(500)}
      style={styles.container}
    >
      <Text style={[styles.title, { color: colors.textSecondary }]}>
        {title}
      </Text>
      <View
        style={[
          styles.card,
          !puzzle && {
            backgroundColor: colors.card,
            borderColor: colors.border,
          },
          puzzle && styles.puzzleStack,
        ]}
      >
        {items.map((item, idx) => (
          <Pressable
            key={item.id}
            onPress={() => handlePress(item)}
            accessibilityRole="button"
            accessibilityLabel={`${item.label}: ${item.subLabel}`}
          >
            {({ pressed }) => (
              <View
                style={[
                  styles.row,
                  puzzle && [
                    styles.puzzleRow,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ],
                  !puzzle &&
                    idx < items.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: colors.border,
                    },
                  pressed && styles.rowPressed,
                ]}
              >
                {puzzle && idx > 0 && (
                  <View
                    pointerEvents="none"
                    style={[
                      styles.notch,
                      {
                        backgroundColor: colors.background,
                        borderColor: colors.border,
                      },
                    ]}
                  />
                )}
                <View style={styles.rowLeft}>
                  <View
                    style={[
                      styles.iconCircle,
                      { backgroundColor: `${item.color}12` },
                    ]}
                  >
                    <Ionicons
                      name={
                        item.icon as React.ComponentProps<
                          typeof Ionicons
                        >['name']
                      }
                      size={20}
                      color={item.color}
                    />
                  </View>
                  <View style={styles.textCol}>
                    <Text
                      style={[styles.label, { color: colors.text }]}
                      numberOfLines={1}
                    >
                      {item.label}
                    </Text>
                    <Text
                      style={[styles.subLabel, { color: colors.textSecondary }]}
                      numberOfLines={1}
                    >
                      {item.subLabel}
                    </Text>
                  </View>
                </View>

                <View style={styles.rowRight}>
                  {item.badge != null && item.badge > 0 && (
                    <View
                      style={[styles.badge, { backgroundColor: item.color }]}
                    >
                      <Text style={styles.badgeText}>{item.badge}</Text>
                    </View>
                  )}
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={colors.textSecondary}
                  />
                </View>
              </View>
            )}
          </Pressable>
        ))}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: SPACING.lg,
    paddingHorizontal: SPACING.md,
  },
  title: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: 10,
    marginLeft: 4,
  },
  card: {
    borderRadius: RADIUS['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    ...SHADOWS.sm,
  },
  puzzleStack: { gap: 4, borderWidth: 0, shadowOpacity: 0, elevation: 0 },
  puzzleRow: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingVertical: 11,
  },
  notch: {
    position: 'absolute',
    top: -1,
    right: 26,
    height: 6,
    width: 16,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: SPACING.md,
    minHeight: 68,
  },
  rowPressed: {
    backgroundColor: 'rgba(0,0,0,0.03)',
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: SPACING.sm,
  },
  iconCircle: {
    width: 42,
    height: 42,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  textCol: { flex: 1 },
  label: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  subLabel: {
    fontSize: 12,
    fontWeight: '400',
    opacity: 0.75,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
});
