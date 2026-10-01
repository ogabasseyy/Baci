import Ionicons from '@react-native-vector-icons/ionicons';
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { Stack } from 'expo-router';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { getClearableCacheStorageKeys } from '@/components/settings/clear-cache-keys';
import {
  ABOUT_LINKS,
  APPEARANCE_OPTIONS,
} from '@/components/settings/constants';
import { SettingsCardSection } from '@/components/settings/SettingsCardSection';
import { SettingsNotificationSection } from '@/components/settings/SettingsNotificationSection';
import { SettingsSectionRow } from '@/components/settings/SettingsSectionRow';
import { styles } from '@/components/settings/styles';
import { StorefrontScreenShell } from '@/components/storefront/StorefrontScreenShell';
import { useToast } from '@/components/ui/Toast';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { BRAND, SPACING } from '@/constants/Colors';
import { usePushNotifications } from '@/hooks/use-push-notifications';
import { useStorefrontInsets } from '@/hooks/use-storefront-insets';
import { clearQueryCachePreservingObservers } from '@/lib/query-cache-observer-safety';
import { queryClient } from '@/lib/query-client';
import { asyncStorage, removeStorageItems } from '@/lib/storage';
import { type AppearanceMode, useSettingsStore } from '@/stores/settings-store';

export default function SettingsScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme];
  const toast = useToast();
  const { getScrollContentStyle } = useStorefrontInsets();
  const appVersion = Constants.expoConfig?.version ?? '1.0.0';

  const appearance = useSettingsStore((state) => state.appearance);
  const setAppearance = useSettingsStore((state) => state.setAppearance);
  const {
    isRegistered,
    isLoading: isPushLoading,
    register: registerPush,
    unregister: unregisterPush,
  } = usePushNotifications();

  const haptic = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {
      // Ignore unsupported haptics environments.
    });
  };

  const handleAppearanceChange = (mode: AppearanceMode) => {
    haptic();
    setAppearance(mode);
  };

  const handleNotificationToggle = async (enabled: boolean) => {
    haptic();

    try {
      if (enabled) {
        await registerPush(undefined, undefined, { force: true });
        return;
      }

      await unregisterPush();
    } catch {
      toast.error('Failed to update notification settings. Please try again.');
    }
  };

  const handleClearCache = () => {
    haptic();
    Alert.alert(
      'Clear cache?',
      'This will remove cached product data and images. Your account and cart will not be affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              clearQueryCachePreservingObservers(queryClient, {
                refetchAccountQueries: true,
              });

              const cacheKeys = getClearableCacheStorageKeys(
                await asyncStorage.getAllKeys()
              );
              await removeStorageItems(cacheKeys);

              toast.success('Cache cleared successfully.');
            } catch {
              toast.error('Failed to clear cache. Please try again.');
            }
          },
        },
      ]
    );
  };

  const openLink = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      toast.error('Unable to open link on this device.');
    }
  };

  const scrollContentStyle = getScrollContentStyle({
    includeBottomInset: false,
    paddingBottom: SPACING.xl,
  });

  return (
    <StorefrontScreenShell
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['bottom']}
    >
      <Stack.Screen options={{ title: 'App Settings' }} />

      <ScrollView
        contentContainerStyle={[styles.scroll, scrollContentStyle]}
        showsVerticalScrollIndicator={false}
      >
        <SettingsCardSection
          cardBackgroundColor={colors.card}
          cardBorderColor={colors.border}
          title="APPEARANCE"
          titleColor={colors.textSecondary}
          delay={100}
        >
          <View style={styles.segmentedControl}>
            {APPEARANCE_OPTIONS.map((option) => {
              const isActive = appearance === option.value;

              return (
                <Pressable
                  key={option.value}
                  onPress={() => handleAppearanceChange(option.value)}
                  style={[
                    styles.segmentOption,
                    isActive
                      ? { backgroundColor: colors.primary }
                      : { backgroundColor: colors.muted },
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: isActive }}
                  accessibilityLabel={`${option.label} appearance mode`}
                >
                  <Ionicons
                    name={option.icon}
                    size={18}
                    color={
                      isActive ? colors.primaryForeground : colors.textSecondary
                    }
                  />
                  <Text
                    style={[
                      styles.segmentLabel,
                      {
                        color: isActive
                          ? colors.primaryForeground
                          : colors.text,
                      },
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </SettingsCardSection>

        <SettingsNotificationSection
          colors={colors}
          isLoading={isPushLoading}
          isRegistered={isRegistered}
          onToggle={(value) => {
            void handleNotificationToggle(value);
          }}
        />

        <SettingsCardSection
          cardBackgroundColor={colors.card}
          cardBorderColor={colors.border}
          title="ABOUT"
          titleColor={colors.textSecondary}
          delay={300}
        >
          <SettingsSectionRow
            borderBottom
            borderColor={colors.border}
            icon="information-circle-outline"
            iconBackgroundColor={`${colors.textSecondary}15`}
            iconColor={colors.textSecondary}
            label="App Version"
            labelColor={colors.text}
            right={
              <Text style={[styles.rowValue, { color: colors.textSecondary }]}>
                {appVersion}
              </Text>
            }
          />
          {ABOUT_LINKS.map((link, index) => (
            <SettingsSectionRow
              key={link.label}
              borderBottom={index !== ABOUT_LINKS.length - 1}
              borderColor={colors.border}
              accessibilityLabel={link.accessibilityLabel}
              accessibilityRole="link"
              icon={link.icon}
              iconBackgroundColor={`${colors.textSecondary}15`}
              iconColor={colors.textSecondary}
              label={link.label}
              labelColor={colors.text}
              onPress={() => {
                void openLink(link.url);
              }}
              right={
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={colors.textSecondary}
                />
              }
            />
          ))}
        </SettingsCardSection>

        <SettingsCardSection
          cardBackgroundColor={colors.card}
          cardBorderColor={colors.border}
          title="DATA"
          titleColor={colors.textSecondary}
          delay={400}
        >
          <SettingsSectionRow
            icon="trash-outline"
            iconBackgroundColor={`${colors.error}15`}
            iconColor={colors.error}
            label="Clear Cache"
            labelColor={colors.text}
            subtitle="Remove cached images and data"
            subtitleColor={colors.textSecondary}
            accessibilityLabel="Clear cached data"
            onPress={handleClearCache}
            right={
              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.textSecondary}
              />
            }
          />
        </SettingsCardSection>

        <Text style={[styles.footer, { color: colors.textSecondary }]}>
          {BRAND.name} v{appVersion}
        </Text>
      </ScrollView>

      <toast.Toast />
    </StorefrontScreenShell>
  );
}
