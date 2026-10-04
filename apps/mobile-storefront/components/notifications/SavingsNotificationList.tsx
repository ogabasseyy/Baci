import Ionicons from '@react-native-vector-icons/ionicons';
import { FlashList } from '@shopify/flash-list';
import type { ReactElement } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { BRAND, RADIUS, SPACING } from '@/constants/Colors';
import type { SavingsNotification } from '@/schemas/savings-notifications';

type SavingsNotificationListProps = {
  header: ReactElement | null;
  isLoading: boolean;
  notifications: SavingsNotification[];
  onOpen: (notification: SavingsNotification) => void;
  onRetry: () => void;
  requestError: string | null;
};

function getNotificationIcon(
  type: string
):
  | 'cash-outline'
  | 'flame-outline'
  | 'flag-outline'
  | 'notifications-outline'
  | 'trophy-outline' {
  if (type.includes('interest')) return 'cash-outline';
  if (type.includes('milestone') || type.includes('completion'))
    return 'trophy-outline';
  if (type.includes('streak')) return 'flame-outline';
  if (type.includes('missed')) return 'flag-outline';
  return 'notifications-outline';
}

export function SavingsNotificationList({
  header,
  isLoading,
  notifications,
  onOpen,
  onRetry,
  requestError,
}: SavingsNotificationListProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const renderEmpty = () => {
    if (isLoading) {
      return (
        <View style={styles.state}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.stateTitle, { color: colors.text }]}>
            Loading savings notifications…
          </Text>
        </View>
      );
    }
    if (requestError) {
      return (
        <View style={styles.state}>
          <Ionicons
            color={colors.textSecondary}
            name="cloud-offline-outline"
            size={48}
          />
          <Text style={[styles.stateTitle, { color: colors.text }]}>
            Couldn&apos;t load savings updates
          </Text>
          <Text
            style={[styles.stateDescription, { color: colors.textSecondary }]}
          >
            {requestError}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Try again"
            onPress={onRetry}
            style={({ pressed }) => [
              styles.retryButton,
              { backgroundColor: colors.primary },
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.state}>
        <Ionicons
          color={colors.textSecondary}
          name="notifications-off-outline"
          size={48}
        />
        <Text style={[styles.stateTitle, { color: colors.text }]}>
          No savings updates yet
        </Text>
        <Text
          style={[styles.stateDescription, { color: colors.textSecondary }]}
        >
          Your plan milestones and credited-interest alerts will appear here.
        </Text>
      </View>
    );
  };

  return (
    <FlashList
      data={notifications}
      keyExtractor={(notification) => notification.id}
      ListEmptyComponent={renderEmpty}
      ListHeaderComponent={header}
      contentContainerStyle={styles.content}
      renderItem={({ item }) => (
        <Pressable
          accessibilityLabel={item.title}
          accessibilityRole="button"
          onPress={() => onOpen(item)}
          style={({ pressed }) => [
            styles.notification,
            { backgroundColor: colors.card, borderColor: colors.border },
            item.readAt === null && {
              borderLeftColor: BRAND.primary,
              borderLeftWidth: 3,
            },
            pressed && styles.pressed,
          ]}
        >
          <View style={[styles.icon, { backgroundColor: colors.background }]}>
            <Ionicons
              color={colors.primary}
              name={getNotificationIcon(item.type)}
              size={22}
            />
          </View>
          <View style={styles.copy}>
            <Text
              numberOfLines={1}
              style={[styles.notificationTitle, { color: colors.text }]}
            >
              {item.title}
            </Text>
            <Text
              numberOfLines={3}
              style={[styles.notificationBody, { color: colors.textSecondary }]}
            >
              {item.body}
            </Text>
            <Text style={[styles.timestamp, { color: colors.textSecondary }]}>
              {new Date(item.createdAt).toLocaleString()}
            </Text>
          </View>
        </Pressable>
      )}
      showsVerticalScrollIndicator={false}
    />
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    gap: SPACING.sm,
    padding: SPACING.md,
  },
  notification: {
    alignItems: 'center',
    borderRadius: RADIUS.xl,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: SPACING.sm,
    padding: SPACING.md,
  },
  icon: {
    alignItems: 'center',
    borderRadius: RADIUS.full,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  copy: {
    flex: 1,
  },
  notificationTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  notificationBody: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  timestamp: {
    fontSize: 11,
    marginTop: SPACING.xs,
  },
  state: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING['3xl'],
  },
  stateTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginTop: SPACING.md,
    textAlign: 'center',
  },
  stateDescription: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: SPACING.xs,
    textAlign: 'center',
  },
  retryButton: {
    borderRadius: RADIUS.full,
    marginTop: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm + SPACING.xs,
  },
  retryText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.72,
  },
});
