import Ionicons from '@react-native-vector-icons/ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect } from 'expo-router';
import {
  ActivityIndicator,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MerchantSetupChat } from '@/components/auth/onboarding-chat/MerchantSetupChat';
import { getMerchantSetupStyles } from '@/components/auth/register/merchant-setup.styles';
import { getStyles } from '@/components/auth/register/register.styles';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/hooks/useTheme';

export default function CompleteProfileScreen() {
  const { colors, isDark } = useTheme();
  const styles = getStyles(colors);
  const setupStyles = getMerchantSetupStyles(colors);
  const { isLoading, user } = useAuth();

  if (isLoading) {
    return (
      <View
        style={[
          styles.container,
          {
            backgroundColor: colors.background,
            alignItems: 'center',
            justifyContent: 'center',
          },
        ]}
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!user) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      {isDark ? (
        <LinearGradient
          colors={['#0D0D1A', '#1A1A2E']}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.header}>
          <View style={setupStyles.headerBrand}>
            <View style={setupStyles.headerMark}>
              <Ionicons color={colors.primary} name="sparkles" size={20} />
            </View>
            <Text style={styles.headerTitle}>Complete Setup</Text>
          </View>
          <Text style={setupStyles.headerMeta}>Baci AI</Text>
        </View>
        <MerchantSetupChat />
      </SafeAreaView>
    </View>
  );
}
