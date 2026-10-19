import Ionicons from '@react-native-vector-icons/ionicons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import {
  Alert,
  Pressable,
  ScrollView,
  StatusBar,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FollowUpAlertsSetting } from '@/components/notifications/FollowUpAlertsSetting';
import { styles } from '@/components/notifications/notifications.styles';
import { ScreenSkeleton } from '@/components/ui/ScreenSkeleton';
import { useAuth } from '@/hooks/useAuth';
import { useMerchant } from '@/hooks/useMerchant';
import { useTheme } from '@/hooks/useTheme';
import { supabase } from '@/lib/supabase';

interface NotificationPreferences {
  merchant_id: string;
  in_app_enabled: boolean;
  banner_enabled: boolean;
  follow_up_notifications_enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
}

export default function NotificationsScreen() {
  const { colors, shadows, isDark } = useTheme();
  const { user: _user } = useAuth();
  const { merchant, isLoading: merchantLoading } = useMerchant();
  const router = useRouter();
  const queryClient = useQueryClient();
  const screenOptions = {
    title: 'Notifications',
    headerLeft: () => (
      <Pressable
        onPress={() => router.back()}
        style={styles.backButton}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Ionicons name="arrow-back" size={24} color={colors.text} />
      </Pressable>
    ),
  };

  // Fetch notification preferences
  const {
    data: preferences,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['notification-preferences', merchant?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notification_preferences')
        .select(
          'merchant_id, in_app_enabled, banner_enabled, follow_up_notifications_enabled, quiet_hours_start, quiet_hours_end'
        )
        .eq('merchant_id', merchant?.id)
        .maybeSingle();

      if (error) throw error;

      // If no preferences found, return defaults
      if (!data) {
        return {
          merchant_id: merchant?.id,
          in_app_enabled: true,
          banner_enabled: true,
          follow_up_notifications_enabled: true,
          quiet_hours_start: null,
          quiet_hours_end: null,
        } as NotificationPreferences;
      }

      return data as NotificationPreferences;
    },
    enabled: !!merchant?.id,
    staleTime: 1000 * 60 * 5,
  });

  const updatePreferencesMutation = useMutation({
    mutationFn: async (updates: Partial<NotificationPreferences>) => {
      if (!merchant?.id) throw new Error('Merchant not found');

      const { error } = await supabase.from('notification_preferences').upsert({
        merchant_id: merchant.id,
        ...updates,
        updated_at: new Date().toISOString(),
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['notification-preferences', merchant?.id],
      });
    },
    onError: (error: unknown) => {
      Alert.alert(
        'Error',
        (error as Error).message || 'Failed to update preferences'
      );
    },
  });

  const toggleInApp = (value: boolean) => {
    updatePreferencesMutation.mutate({ in_app_enabled: value });
  };

  const toggleBanner = (value: boolean) => {
    updatePreferencesMutation.mutate({ banner_enabled: value });
  };

  if (isLoading || merchantLoading) {
    return (
      <>
        <Stack.Screen options={screenOptions} />
        <SafeAreaView
          style={[styles.container, { backgroundColor: colors.background }]}
          edges={['bottom']}
        >
          <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
          <ScreenSkeleton variant="settings" cards={4} />
        </SafeAreaView>
      </>
    );
  }

  if (error) {
    return (
      <>
        <Stack.Screen options={screenOptions} />
        <SafeAreaView
          style={[styles.container, { backgroundColor: colors.background }]}
          edges={['bottom']}
        >
          <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
          <View style={styles.loadingContainer}>
            <Ionicons
              name="alert-circle-outline"
              size={48}
              color={colors.notification}
            />
            <Text style={[styles.infoTitle, { color: colors.text }]}>
              Failed to load notifications
            </Text>
            <Text
              style={[styles.infoSubtitle, { color: colors.textSecondary }]}
            >
              Please check your connection and try again.
            </Text>
            <Pressable
              style={[styles.retryButton, { backgroundColor: colors.primary }]}
              onPress={() => {
                void refetch();
              }}
              accessibilityRole="button"
              accessibilityLabel="Retry loading notification preferences"
            >
              <Text style={styles.retryButtonText}>Retry</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={screenOptions} />
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={['bottom']}
      >
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
        >
          <View style={styles.infoSection}>
            <Ionicons
              name="notifications-circle-outline"
              size={64}
              color={colors.primary}
            />
            <Text style={[styles.infoTitle, { color: colors.text }]}>
              Notification Preferences
            </Text>
            <Text
              style={[styles.infoSubtitle, { color: colors.textSecondary }]}
            >
              Choose how you want to be notified about your store activities.
            </Text>
          </View>

          <View style={[styles.cardShadow, shadows.sm]}>
            <View style={[styles.card, { backgroundColor: colors.card }]}>
              <View style={styles.settingRow}>
                <View style={styles.settingInfo}>
                  <Text style={[styles.settingLabel, { color: colors.text }]}>
                    In-App Notifications
                  </Text>
                  <Text
                    style={[
                      styles.settingDesc,
                      { color: colors.textSecondary },
                    ]}
                  >
                    Show alerts within the admin app
                  </Text>
                </View>
                <Switch
                  value={preferences?.in_app_enabled ?? true}
                  onValueChange={toggleInApp}
                  trackColor={{
                    false: colors.border,
                    true: `${colors.primary}50`,
                  }}
                  thumbColor={
                    (preferences?.in_app_enabled ?? true)
                      ? colors.card
                      : colors.textMuted
                  }
                />
              </View>

              <View
                style={[styles.divider, { backgroundColor: colors.border }]}
              />

              <View style={styles.settingRow}>
                <View style={styles.settingInfo}>
                  <Text style={[styles.settingLabel, { color: colors.text }]}>
                    Push Notifications
                  </Text>
                  <Text
                    style={[
                      styles.settingDesc,
                      { color: colors.textSecondary },
                    ]}
                  >
                    Show banners on your device lock screen
                  </Text>
                </View>
                <Switch
                  value={preferences?.banner_enabled ?? true}
                  onValueChange={toggleBanner}
                  trackColor={{
                    false: colors.border,
                    true: `${colors.primary}50`,
                  }}
                  thumbColor={
                    (preferences?.banner_enabled ?? true)
                      ? colors.card
                      : colors.textMuted
                  }
                />
              </View>

              <View
                style={[styles.divider, { backgroundColor: colors.border }]}
              />

              <FollowUpAlertsSetting
                colors={colors}
                enabled={preferences?.follow_up_notifications_enabled ?? true}
                onValueChange={(value) =>
                  updatePreferencesMutation.mutate({
                    follow_up_notifications_enabled: value,
                  })
                }
              />
            </View>
          </View>

          <View style={styles.noteSection}>
            <Ionicons
              name="information-circle-outline"
              size={20}
              color={colors.textMuted}
            />
            <Text style={[styles.noteText, { color: colors.textMuted }]}>
              System-level notification permissions can be managed in your
              device settings.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}
