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
import {
  CHAT_WIDGET_DEFAULT_BOTTOM_OFFSET,
  CHAT_WIDGET_FAB_SIZE,
} from '@/constants/layout';
import type { SavingsNotification } from '@/schemas/savings-notifications';

type SavingsNotificationListProps = {
  header: ReactElement | null;
  /** Scrolls with the list, so it never covers the empty state. */
  footer?: ReactElement | null;
  isLoading: boolean;
  notifications: SavingsNotification[];
  onOpen: (notification: SavingsNotification) => void;
  onRetry: () => void;
  requestError: string | null;
};

// Pinned locale with explicit fields (house en-NG style, see the orders and
// receipts screens): stable across device locales, unlike a bare
// toLocaleString(). createdAt is an ISO datetime, which the
// format-date-time-display helper does not accept.
export function formatSavingsNotificationTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-NG', {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function getSavingsNotificationAccessibilityLabel(
  title: string,
  createdAt: string
): string {
  return `${title}, ${formatSavingsNotificationTimestamp(createdAt)}`;
}

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
  footer,
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
            // A static style: on device the function form rendered no
            // button at all in walk 14 (white text with no background).
            style={[styles.retryButton, { backgroundColor: colors.primary }]}
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
          Your plan milestones and interest updates will appear here.
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
      ListFooterComponent={footer}
      contentContainerStyle={styles.content}
      renderItem={({ item }) => (
        <Pressable
          accessibilityLabel={getSavingsNotificationAccessibilityLabel(
            item.title,
            item.createdAt
          )}
          accessibilityRole="button"
          onPress={() => onOpen(item)}
          // Only the press feedback is a style function: the card itself is
          // a plain View, so its layout never depends on a function style.
          style={({ pressed }) => (pressed ? styles.pressed : null)}
        >
          <View
            testID="savings-notification-card"
            style={[
              styles.notification,
              { backgroundColor: colors.card, borderColor: colors.border },
              // Every card keeps the same left edge; only unread ones colour
              // it, so read and unread content line up.
              {
                borderLeftColor:
                  item.readAt === null ? BRAND.primary : colors.border,
                borderLeftWidth: 3,
              },
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
                style={[
                  styles.notificationBody,
                  { color: colors.textSecondary },
                ]}
              >
                {item.body}
              </Text>
              <Text style={[styles.timestamp, { color: colors.textSecondary }]}>
                {formatSavingsNotificationTimestamp(item.createdAt)}
              </Text>
            </View>
          </View>
        </Pressable>
      )}
      showsVerticalScrollIndicator={false}
    />
  );
}

/** Clears the floating AI button: its bottom offset plus its height and a gap. */
export const NOTIFICATIONS_BOTTOM_INSET =
  CHAT_WIDGET_DEFAULT_BOTTOM_OFFSET + CHAT_WIDGET_FAB_SIZE + SPACING.sm;

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    gap: SPACING.sm,
    padding: SPACING.md,
    // The footer ("View your orders") must sit above the floating AI
    // button's whole band, wherever it is snapped (left or right edge).
    paddingBottom: NOTIFICATIONS_BOTTOM_INSET,
  },
  notification: {
    alignItems: 'center',
    borderRadius: RADIUS.xl,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: SPACING.sm,
    // FlashList ignores the container's gap, so each card keeps its own space.
    marginBottom: SPACING.sm,
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
