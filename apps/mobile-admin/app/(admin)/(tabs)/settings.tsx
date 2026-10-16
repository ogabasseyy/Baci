import Ionicons from '@react-native-vector-icons/ionicons';
import { useRouter } from 'expo-router';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import SettingsListItem from '@/components/settings/SettingsListItem';
import { APP_VERSION_LABEL } from '@/constants/app-info';
import { useOnboarding } from '@/context/OnboardingContext';
import { useAuth } from '@/hooks/useAuth';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useTheme } from '@/hooks/useTheme';

export default function SettingsScreen() {
  const { resetOnboarding } = useOnboarding();
  const { signOut } = useAuth();
  const { unregisterPush } = usePushNotifications();
  const { colors } = useTheme();
  const _router = useRouter();

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await signOut(unregisterPush);
        },
      },
    ]);
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top']}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Store Info */}
        <View
          style={[
            styles.section,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
            STORE
          </Text>
          <SettingsListItem
            icon="storefront-outline"
            title="Store Profile"
            subtitle="Name, logo, contact info"
          />
          <SettingsListItem
            icon="time-outline"
            title="Business Hours"
            subtitle="Set operating hours"
          />
          <SettingsListItem
            icon="location-outline"
            title="Store Locations"
            subtitle="Manage pickup points"
          />
        </View>

        {/* Growth & Marketing */}
        <View
          style={[
            styles.section,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
            GROWTH &amp; MARKETING
          </Text>
          <SettingsListItem
            icon="bar-chart-outline"
            title="Analytics & Tracking"
            subtitle="Pixels, CAPI, Setup"
            onPress={() => _router.push('/(admin)/analytics-config')}
          />
          <SettingsListItem
            icon="mail-outline"
            title="Email Domain"
            subtitle="Send emails from your own domain"
            onPress={() => _router.push('/(admin)/email-domain-settings')}
          />
        </View>

        {/* Notifications */}
        <View
          style={[
            styles.section,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
            NOTIFICATIONS
          </Text>
          <SettingsListItem
            icon="notifications-outline"
            title="Push Notifications"
            toggle={true}
          />
          <SettingsListItem
            icon="mail-outline"
            title="Email Alerts"
            toggle={true}
          />
          <SettingsListItem
            icon="musical-notes-outline"
            title="Order Sound"
            toggle={false}
          />
        </View>

        {/* Orders */}
        <View
          style={[
            styles.section,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
            ORDERS
          </Text>
          <SettingsListItem
            icon="print-outline"
            title="Receipt Printer"
            subtitle="Connect thermal printer"
          />
          <SettingsListItem
            icon="bicycle-outline"
            title="Delivery Settings"
            subtitle="Zones, fees, partners"
          />
          <SettingsListItem
            icon="pricetag-outline"
            title="Tax Configuration"
            subtitle="VAT and pricing rules"
          />
        </View>

        {/* Account */}
        <View
          style={[
            styles.section,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
            ACCOUNT
          </Text>
          <SettingsListItem
            icon="people-outline"
            title="Team Members"
            subtitle="Manage staff access"
          />
          <SettingsListItem
            icon="shield-checkmark-outline"
            title="Security"
            subtitle="Password, 2FA"
            onPress={() => _router.push('/(admin)/security')}
          />
          <SettingsListItem icon="help-circle-outline" title="Help & Support" />
        </View>

        {/* Logout */}
        <Pressable
          style={({ pressed }) => [
            styles.logoutButton,
            { backgroundColor: colors.card, borderColor: colors.border },
            pressed && { opacity: 0.7 },
          ]}
          onPress={handleLogout}
          accessibilityRole="button"
        >
          <Ionicons name="log-out-outline" size={20} color={colors.error} />
          <Text style={[styles.logoutText, { color: colors.error }]}>
            Sign Out
          </Text>
        </Pressable>

        <Text style={[styles.version, { color: colors.textSecondary }]}>
          {APP_VERSION_LABEL}
        </Text>

        {/* DEV: Reset Onboarding */}
        {__DEV__ && (
          <Pressable
            style={[
              styles.devButton,
              {
                backgroundColor: colors.warningLight,
                borderColor: colors.warning,
              },
            ]}
            onPress={async () => {
              await resetOnboarding();
              Alert.alert(
                'Onboarding Reset',
                'You will now be taken to the onboarding screen.',
                [
                  {
                    text: 'OK',
                    onPress: () => _router.replace('/(auth)/onboarding'),
                  },
                ]
              );
            }}
          >
            <Ionicons name="refresh-outline" size={20} color={colors.warning} />
            <Text style={{ color: colors.warning, fontWeight: '600' }}>
              Reset Onboarding (Dev)
            </Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: {
    padding: 16,
    gap: 16,
  },
  section: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  logoutText: {
    fontSize: 15,
    fontWeight: '600',
  },
  version: {
    textAlign: 'center',
    fontSize: 12,
    marginTop: 8,
  },
  devButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
    marginTop: 16,
  },
});
