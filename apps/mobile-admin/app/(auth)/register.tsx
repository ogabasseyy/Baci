import Ionicons from '@react-native-vector-icons/ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RegisterChat } from '@/components/auth/onboarding-chat/RegisterChat';
import { getMerchantSetupStyles } from '@/components/auth/register/merchant-setup.styles';
import { getStyles } from '@/components/auth/register/register.styles';
import { useLightNavigationBar } from '@/hooks/useLightNavigationBar';
import { useTheme } from '@/hooks/useTheme';

export default function RegisterScreen() {
  const { colors, isDark } = useTheme();
  const styles = getStyles(colors);
  const setupStyles = getMerchantSetupStyles(colors);
  const router = useRouter();
  useLightNavigationBar(isDark);

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
            <Pressable
              accessibilityLabel="Back"
              accessibilityRole="button"
              onPress={() => router.back()}
              style={setupStyles.headerMark}
            >
              <Ionicons color={colors.primary} name="arrow-back" size={20} />
            </Pressable>
            <Text style={styles.headerTitle}>Create Account</Text>
          </View>
          <Text style={setupStyles.headerMeta}>Baci AI</Text>
        </View>
        <RegisterChat />
      </SafeAreaView>
    </View>
  );
}
