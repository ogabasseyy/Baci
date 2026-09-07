import Ionicons from '@react-native-vector-icons/ionicons';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StatusBar,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { styles } from '@/components/menu/menu.styles';
import { SubscriptionStatusCard } from '@/components/settings/SubscriptionStatusCard';
import { APP_VERSION_LABEL } from '@/constants/app-info';
import { RADIUS, SPACING } from '@/constants/theme';
import { useOnboarding } from '@/context/OnboardingContext';
import { useAdminTabScrollToTop } from '@/hooks/useAdminTabScrollToTop';
import { useAuth } from '@/hooks/useAuth';
import { useExpenseAccess } from '@/hooks/useExpenseAccess';
import { useMerchant } from '@/hooks/useMerchant';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useRevenueCat } from '@/hooks/useRevenueCat';
import { useTheme } from '@/hooks/useTheme';
import { baciFeatureGates, type MobileFeatureGate } from '@/lib/feature-gates';
import { isBaciPaystackSettlementCountry } from '@/lib/is-baci-paystack-settlement-country';
import { createMenuSections, type MenuItem } from './menu-sections';

export default function MenuScreen() {
  const scrollRef = useAdminTabScrollToTop<ScrollView>('menu');
  const { colors, shadows, isDark } = useTheme();
  const { signOut, user } = useAuth();
  const { resetOnboarding } = useOnboarding();
  const { isPro, customerInfo } = useRevenueCat();
  const { merchant, isLoading: isMerchantLoading } = useMerchant();
  const {
    canCreate: canCreateExpenses,
    canManageIntegrations,
    canView: canViewExpenses,
  } = useExpenseAccess();
  const { unregisterPush } = usePushNotifications();
  const router = useRouter();
  const hasProSubscription =
    isPro || baciFeatureGates.hasFullProAccess(merchant);
  const isSubscriptionStatusLoading = !isPro && isMerchantLoading;
  const isPaystackSettlementCountry = merchant
    ? isBaciPaystackSettlementCountry(merchant.country)
    : false;
  const isMerchantOwner = Boolean(
    user?.id && merchant?.user_id && user.id === merchant.user_id
  );

  const canAccessFeature = (feature: MobileFeatureGate) =>
    feature === 'custom_email_domain'
      ? baciFeatureGates.hasFeature(merchant, feature)
      : isPro || baciFeatureGates.hasFeature(merchant, feature);

  const proBadge = (feature: MobileFeatureGate) =>
    canAccessFeature(feature) ? undefined : 'PRO';

  const openFeature = (
    feature: MobileFeatureGate,
    label: string,
    pathname: string
  ) => {
    if (canAccessFeature(feature)) {
      router.push(pathname);
      return;
    }

    Alert.alert('Baci Pro', `${label} is available on Baci Pro.`, [
      { text: 'Not now', style: 'cancel' },
      {
        text: 'Upgrade',
        onPress: () => router.push('/(admin)/subscribe'),
      },
    ]);
  };

  const handleLogout = () => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: async () => {
          await signOut(unregisterPush);
        },
      },
    ]);
  };

  const menuSections = createMenuSections({
    canCreateExpenses,
    canManageIntegrations,
    canViewExpenses,
    destructiveColor: colors.error,
    isMerchantOwner,
    isPaystackSettlementCountry,
    onFeaturePress: openFeature,
    onLogout: handleLogout,
    onNavigate: (pathname) => router.push(pathname),
    proBadge,
  });

  const renderMenuItem = (item: MenuItem) => (
    <Pressable
      key={item.id}
      style={({ pressed }) => [
        styles.menuItem,
        pressed && { backgroundColor: colors.cardHover },
      ]}
      onPress={item.onPress}
      accessibilityLabel={
        item.description ? `${item.label}. ${item.description}` : item.label
      }
      accessibilityRole="button"
      accessibilityHint={`Navigate to ${item.label}`}
    >
      <View
        style={[
          styles.menuIcon,
          { backgroundColor: `${item.iconColor || colors.primary}20` },
        ]}
      >
        <Ionicons
          name={item.icon}
          size={20}
          color={item.iconColor || colors.primary}
        />
      </View>

      <View style={styles.menuContent}>
        <View style={styles.menuLabelRow}>
          <Text
            style={[
              styles.menuLabel,
              { color: item.destructive ? colors.error : colors.text },
            ]}
          >
            {item.label}
          </Text>
          {item.badge ? (
            <View style={[styles.badge, { backgroundColor: colors.goldLight }]}>
              <Text style={[styles.badgeText, { color: colors.gold }]}>
                {item.badge}
              </Text>
            </View>
          ) : null}
        </View>
        {item.description ? (
          <Text
            style={[styles.menuDescription, { color: colors.textSecondary }]}
          >
            {item.description}
          </Text>
        ) : null}
      </View>

      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top']}
    >
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Menu</Text>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Subscription Card */}
        <SubscriptionStatusCard
          isLoading={isSubscriptionStatusLoading}
          isPro={hasProSubscription}
          customerInfo={customerInfo}
          colors={colors}
          shadows={shadows}
          onPress={() => router.push('/(admin)/subscribe')}
        />

        {/* Menu Sections */}
        {menuSections.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text
              style={[styles.sectionTitle, { color: colors.textSecondary }]}
            >
              {section.title}
            </Text>
            <View
              style={[
                styles.sectionCard,
                { backgroundColor: colors.card },
                shadows.sm,
              ]}
            >
              {section.items.map((item, index) => (
                <React.Fragment key={item.id}>
                  {renderMenuItem(item)}
                  {index < section.items.length - 1 && (
                    <View
                      style={[
                        styles.divider,
                        { backgroundColor: colors.border },
                      ]}
                    />
                  )}
                </React.Fragment>
              ))}
            </View>
          </View>
        ))}

        {/* App Version */}
        <Text style={[styles.version, { color: colors.textMuted }]}>
          {APP_VERSION_LABEL}
        </Text>

        {/* DEV: Reset Onboarding */}
        {__DEV__ && (
          <Pressable
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 12,
              borderRadius: RADIUS.lg,
              borderWidth: 1,
              gap: 8,
              marginTop: SPACING.md,
              marginBottom: SPACING['3xl'],
              backgroundColor: '#FEF3C7',
              borderColor: '#F59E0B',
              minHeight: 44,
            }}
            accessibilityLabel="Reset Onboarding for development testing"
            accessibilityRole="button"
            accessibilityHint="Resets onboarding state and returns to onboarding screen"
            onPress={async () => {
              await resetOnboarding();
              Alert.alert(
                'Onboarding Reset',
                'You will now be taken to the onboarding screen.',
                [
                  {
                    text: 'OK',
                    onPress: () => router.replace('/(auth)/onboarding'),
                  },
                ]
              );
            }}
          >
            <Ionicons name="refresh-outline" size={20} color="#D97706" />
            <Text style={{ color: '#D97706', fontWeight: '600' }}>
              Reset Onboarding (Dev)
            </Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
