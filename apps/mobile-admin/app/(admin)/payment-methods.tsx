import Ionicons from '@react-native-vector-icons/ionicons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useLayoutEffect, useRef } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StatusBar,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PaymentMethodsSection } from '@/components/payment-methods/PaymentMethodsSection';
import {
  getRenderablePaymentMethods,
  type PaymentMethodCategory,
  type PaymentMethodField,
  paymentMethods,
  paymentSettingsSelectColumns,
} from '@/components/payment-methods/payment-methods';
import { styles } from '@/components/payment-methods/payment-methods.styles';
import { fetchPaymentSettings } from '@/components/payment-methods/payment-settings-query';
import { ScreenSkeleton } from '@/components/ui/ScreenSkeleton';
import { useMerchant } from '@/hooks/useMerchant';
import { useMerchantScopedPending } from '@/hooks/useMerchantScopedPending';
import { useTheme } from '@/hooks/useTheme';
import { invalidateStoreReadiness } from '@/lib/invalidate-store-readiness';
import { supabase } from '@/lib/supabase';
import { tryRefreshStoreReadiness } from '@/lib/try-refresh-store-readiness';
import type { PaymentSettings } from '@/schemas/payment-settings';

function handleManagePayments(): void {
  Linking.openURL('https://usebaci.com/dashboard/settings/payments');
}

export default function PaymentMethodsScreen() {
  const { colors, shadows, isDark } = useTheme();
  const {
    merchant,
    isLoading: merchantLoading,
    error: merchantError,
  } = useMerchant();
  const queryClient = useQueryClient();
  const activeMerchantIdRef = useRef(merchant?.id ?? null);
  useLayoutEffect(() => {
    activeMerchantIdRef.current = merchant?.id ?? null;
  }, [merchant?.id]);
  const togglePending = useMerchantScopedPending();
  const screenOptions = {
    title: 'Payment Methods',
    headerStyle: { backgroundColor: colors.background },
    headerTintColor: colors.text,
  };
  const sections = [
    { title: 'Payment Gateways', category: 'gateway' },
    { title: 'Buy Now, Pay Later', category: 'bnpl' },
    { title: 'Offline Payments', category: 'offline' },
  ] as const satisfies ReadonlyArray<{
    title: string;
    category: PaymentMethodCategory;
  }>;

  // Fetch actual payment settings
  const {
    data: settings,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['payment-settings', merchant?.id],
    queryFn: () => {
      if (!merchant?.id) throw new Error('Merchant not found');
      return fetchPaymentSettings(merchant.id, paymentSettingsSelectColumns);
    },
    enabled: !!merchant?.id,
    staleTime: 1000 * 60 * 5,
  });

  // Toggle mutation with Optimistic Updates (2026 Best Practice)
  const toggleMutation = useMutation({
    mutationFn: async ({
      field,
      merchantId,
      settingsId,
      value,
    }: {
      field: PaymentMethodField;
      merchantId: string;
      settingsId: string;
      value: boolean;
    }) => {
      const { error } = await supabase
        .from('merchant_feature_settings')
        .update({ [field]: value })
        .eq('id', settingsId)
        .eq('merchant_id', merchantId);
      if (error) throw error;
    },
    onMutate: async ({ field, merchantId, value }) => {
      // Cancel any outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({
        queryKey: ['payment-settings', merchantId],
      });

      // Snapshot the previous value
      const previousSettings = queryClient.getQueryData([
        'payment-settings',
        merchantId,
      ]);

      // Optimistically update to the new value
      queryClient.setQueryData(
        ['payment-settings', merchantId],
        (old: PaymentSettings | undefined) => {
          if (!old) return old;
          return {
            ...old,
            [field]: value,
          };
        }
      );

      // Return a context object with the snapshotted value
      togglePending.begin(merchantId);
      return {
        merchantId,
        previousSettings,
      };
    },
    onSuccess: async (_data, _variables, context) => {
      const merchantId = context?.merchantId;
      if (merchantId) {
        await tryRefreshStoreReadiness(() =>
          invalidateStoreReadiness(queryClient, merchantId)
        );
      }
    },
    onError: (error, _variables, context) => {
      // If the mutation fails, use the context returned from onMutate to roll back
      if (context?.merchantId && context.previousSettings) {
        queryClient.setQueryData(
          ['payment-settings', context.merchantId],
          context.previousSettings
        );
      }
      if (context?.merchantId !== activeMerchantIdRef.current) return;
      const msg = (error as Error)?.message || 'Failed to update setting';
      Alert.alert('Error', msg);
    },
    onSettled: async (_data, _error, _variables, context) => {
      // Always refetch after error or success:
      if (context?.merchantId) {
        togglePending.end(context.merchantId);
        await queryClient.invalidateQueries({
          queryKey: ['payment-settings', context.merchantId],
        });
      }
    },
  });

  const handleTogglePaymentMethod = (
    field: PaymentMethodField,
    value: boolean
  ) => {
    if (!merchant?.id || !settings?.id) return;
    toggleMutation.mutate({
      field,
      merchantId: merchant.id,
      settingsId: settings.id,
      value,
    });
  };

  const loadError = merchantError ?? (isError ? error : null);
  const renderablePaymentMethods = getRenderablePaymentMethods(
    settings,
    paymentMethods
  );

  if (merchantLoading || isLoading) {
    return (
      <>
        <Stack.Screen options={screenOptions} />
        <SafeAreaView
          style={[styles.container, { backgroundColor: colors.background }]}
          edges={['bottom']}
        >
          <ScreenSkeleton variant="settings" cards={6} />
        </SafeAreaView>
      </>
    );
  }

  if (loadError) {
    const errorMessage =
      loadError instanceof Error
        ? loadError.message
        : 'Payment settings are unavailable right now.';

    return (
      <>
        <Stack.Screen options={screenOptions} />
        <SafeAreaView
          style={[styles.container, { backgroundColor: colors.background }]}
          edges={['bottom']}
        >
          <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
          <View style={styles.errorState}>
            <Ionicons
              name="alert-circle-outline"
              size={48}
              color={colors.notification}
            />
            <Text style={[styles.errorTitle, { color: colors.text }]}>
              Failed to load payment methods
            </Text>
            <Text
              style={[styles.errorDescription, { color: colors.textSecondary }]}
            >
              {errorMessage}
            </Text>
            <Pressable
              style={[styles.retryButton, { backgroundColor: colors.primary }]}
              onPress={() => {
                void refetch();
              }}
              accessibilityRole="button"
              accessibilityLabel="Retry loading payment methods"
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
          {sections.map((section) => (
            <PaymentMethodsSection
              key={section.category}
              title={section.title}
              category={section.category}
              methods={renderablePaymentMethods}
              settings={settings}
              colors={colors}
              shadowStyle={shadows.sm}
              isPending={togglePending.isPending(merchant?.id ?? null)}
              onToggle={handleTogglePaymentMethod}
            />
          ))}

          {/* Info Notice */}
          <View
            style={[
              styles.notice,
              { backgroundColor: colors.infoLight || '#EFF6FF' },
            ]}
          >
            <Ionicons
              name="information-circle"
              size={20}
              color={colors.info || '#3B82F6'}
            />
            <Text
              style={[styles.noticeText, { color: colors.info || '#3B82F6' }]}
            >
              API keys and webhook configuration available on web dashboard.
            </Text>
          </View>

          {/* Manage Button */}
          <Pressable
            style={[styles.manageButton, { backgroundColor: colors.primary }]}
            onPress={handleManagePayments}
          >
            <Ionicons
              name="settings-outline"
              size={20}
              color={colors.textOnPrimary}
            />
            <Text style={styles.manageButtonText}>Advanced Settings</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}
