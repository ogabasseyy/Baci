import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { BRAND, RADIUS, SPACING } from '@/constants/Colors';
import type { SavingsNotification } from '@/schemas/savings-notifications';

function getNotificationIcon(type: string) {
  if (type.includes('interest')) return 'cash-outline';
  if (type.includes('milestone') || type.includes('completion'))
    return 'trophy-outline';
  if (type.includes('streak')) return 'flame-outline';
  if (type.includes('missed')) return 'flag-outline';
  return 'notifications-outline';
}

export function SavingsNotificationCard({
  notification,
  label,
  timestamp,
  onOpen,
}: {
  notification: SavingsNotification;
  label: string;
  timestamp: string;
  onOpen: (notification: SavingsNotification) => void;
}) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const [pressed, setPressed] = useState(false);

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityHint={`${notification.body} Open this savings plan.`}
      accessibilityRole="button"
      onPress={() => onOpen(notification)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: pressed ? 0.72 : 1,
        },
        notification.readAt === null && styles.unread,
      ]}
    >
      <View style={[styles.icon, { backgroundColor: colors.background }]}>
        <Ionicons
          color={BRAND.primary}
          name={getNotificationIcon(notification.type)}
          size={22}
        />
      </View>
      <View style={styles.copy}>
        <Text
          ellipsizeMode="tail"
          numberOfLines={1}
          style={[styles.title, { color: colors.text }]}
        >
          {notification.title}
        </Text>
        <Text
          ellipsizeMode="tail"
          numberOfLines={3}
          style={[styles.body, { color: colors.textSecondary }]}
        >
          {notification.body}
        </Text>
        <Text style={[styles.timestamp, { color: colors.textSecondary }]}>
          {timestamp}
        </Text>
      </View>
      <Ionicons color={colors.textSecondary} name="chevron-forward" size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    borderRadius: RADIUS.xl,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
    minHeight: 104,
    padding: SPACING.md,
  },
  unread: { borderLeftColor: BRAND.primary, borderLeftWidth: 3 },
  icon: {
    alignItems: 'center',
    borderRadius: RADIUS.full,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, fontWeight: '700', lineHeight: 20 },
  body: { fontSize: 13, lineHeight: 18, marginTop: SPACING.xs },
  timestamp: { fontSize: 11, marginTop: SPACING.sm },
});
