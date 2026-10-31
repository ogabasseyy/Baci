import type { Href } from 'expo-router';
import { router } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { getAccountMenuSections } from '@/components/profile/account-menu';
import { type MenuItem, MenuSection } from '@/components/profile/MenuSection';
import { ProfileHeader } from '@/components/profile/ProfileHeader';
import { SocialLinks } from '@/components/profile/SocialLinks';
import { StorefrontScreenShell } from '@/components/storefront/StorefrontScreenShell';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useMerchant } from '@/hooks';
import { useAccountLoyaltyPoints } from '@/hooks/use-account-loyalty-points';
import { useAuthStatus } from '@/hooks/use-auth-guard';
import { useConfirmSignOut } from '@/hooks/use-confirm-sign-out';
import { useStorefrontInsets } from '@/hooks/use-storefront-insets';
import { type Customer, useAuthStore } from '@/stores/auth-store';

const handleMenuPress = (item: MenuItem): void => {
  if (item.action) {
    item.action();
    return;
  }

  if (item.route) {
    router.push(item.route as Href);
  }
};

export default function AccountScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { customer, session } = useAuthStore(
    useShallow((state) => ({
      customer: state.customer,
      session: state.session,
    }))
  );
  const signOut = useAuthStore((state) => state.signOut);
  const { data: merchant } = useMerchant();
  const { isInitialized, user: authUser } = useAuthStatus();
  const isFocused = useIsFocused();
  const safeCustomer = customer ?? null;
  const userMeta = session?.user?.user_metadata;
  const effectiveCustomer: Customer | null =
    safeCustomer ??
    (session?.user
      ? {
          id: session.user.id,
          email: session.user.email ?? '',
          first_name:
            typeof userMeta?.first_name === 'string'
              ? userMeta.first_name
              : undefined,
          last_name:
            typeof userMeta?.last_name === 'string'
              ? userMeta.last_name
              : undefined,
        }
      : null);
  const loyaltyPoints = useAccountLoyaltyPoints(safeCustomer, isFocused);
  const { getScrollContentStyle } = useStorefrontInsets();
  const menuSections = getAccountMenuSections({
    canDeleteAccount: Boolean(authUser),
    hasCustomerProfile: Boolean(safeCustomer),
  });

  const confirmSignOut = useConfirmSignOut(signOut);

  if (!isInitialized) {
    return (
      <View
        style={[
          styles.container,
          {
            backgroundColor: colors.background,
            justifyContent: 'center',
            alignItems: 'center',
          },
        ]}
      >
        <ActivityIndicator size="large" color={colors.tint} />
      </View>
    );
  }

  if (!authUser) {
    return null;
  }

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: confirmSignOut,
      },
    ]);
  };

  return (
    <StorefrontScreenShell
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top']}
    >
      <ScrollView
        testID="account-scrollview"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={getScrollContentStyle({
          includeBottomInset: false,
        })}
      >
        {effectiveCustomer ? (
          <ProfileHeader
            customer={effectiveCustomer}
            loyaltyPoints={loyaltyPoints}
          />
        ) : null}

        {menuSections
          .filter((section) => section.visible)
          .map((section, idx) => (
            <MenuSection
              key={section.title}
              title={section.title}
              items={section.items}
              colors={colors}
              delayIndex={idx}
              onItemPress={handleMenuPress}
            />
          ))}

        {merchant?.social_media ? (
          <SocialLinks
            socialMedia={merchant.social_media}
            phone={merchant.phone}
            colors={colors}
          />
        ) : null}

        <Pressable
          onPress={handleSignOut}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
          style={styles.signOutButton}
        >
          <Text style={[styles.signOutText, { color: colors.error }]}>
            Sign Out
          </Text>
        </Pressable>

        <Text style={[styles.version, { color: colors.textSecondary }]}>
          ENVIRONMENT: PRODUCTION • VERSION 1.0.0
        </Text>
      </ScrollView>
    </StorefrontScreenShell>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  signOutButton: {
    alignSelf: 'center',
    marginTop: 44,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  signOutText: {
    fontSize: 15,
    fontWeight: '600',
  },
  version: {
    textAlign: 'center',
    fontSize: 10,
    marginTop: 32,
    letterSpacing: 2,
    fontWeight: '700',
    opacity: 0.4,
  },
});
