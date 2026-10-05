import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useSavingsNotificationInbox } from '@/hooks/use-savings-notification-inbox';
import type { SavingsNotification } from '@/schemas/savings-notifications';
import { SavingsNotificationList } from './SavingsNotificationList';
import { SavingsNotificationPreferences } from './SavingsNotificationPreferences';

export function SavingsNotificationsScreen({
  merchantId,
  userId,
}: {
  merchantId: string | null;
  userId: string | null;
}) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const inbox = useSavingsNotificationInbox({
    enabled: Boolean(merchantId && userId),
    merchantId,
    userId,
  });

  const openNotification = (notification: SavingsNotification) => {
    // Await the mark-read so a failure keeps the user on this screen, where
    // the actionError banner renders. Navigating first would strand that
    // error on a screen the user just left.
    void (async () => {
      try {
        await inbox.markRead(notification.id);
      } catch {
        return;
      }
      router.push({
        pathname: '/wallet',
        params: { action: 'savings', savingsGoalId: notification.goalId },
      });
    })();
  };

  return (
    <View style={styles.container}>
      {inbox.actionError ? (
        <View
          style={[
            styles.error,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.errorText, { color: colors.text }]}>
            {inbox.actionError}
          </Text>
        </View>
      ) : null}
      <SavingsNotificationList
        header={
          inbox.preferences ? (
            <SavingsNotificationPreferences
              isSaving={inbox.isSaving}
              onUpdate={inbox.updatePreferences}
              preferences={inbox.preferences}
            />
          ) : null
        }
        isLoading={inbox.isLoading}
        notifications={inbox.notifications}
        onOpen={openNotification}
        onRetry={inbox.retry}
        requestError={
          merchantId && userId
            ? inbox.error
            : 'Savings notifications are unavailable for this store.'
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  error: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
  },
  errorText: {
    fontSize: 13,
    lineHeight: 18,
  },
});
